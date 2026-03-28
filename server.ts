import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import cors from "cors";
import Database from "better-sqlite3";
import { evaluateAnswer, getEmbeddings, calculateCosineSimilarity } from "./src/services/evaluationService.ts";

console.log("GROQ_API_KEY present:", !!process.env.GROQ_API_KEY);

const JWT_SECRET = process.env.JWT_SECRET || "evalai-secret-key";
const db = new Database("evalai.db");

// Initialize Database Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT CHECK(role IN ('teacher', 'student')) NOT NULL,
    securityQuestion TEXT,
    securityAnswer TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS classrooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    teacherId INTEGER NOT NULL,
    joinCode TEXT UNIQUE,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (teacherId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS classroom_students (
    classroomId INTEGER NOT NULL,
    studentId INTEGER NOT NULL,
    PRIMARY KEY (classroomId, studentId),
    FOREIGN KEY (classroomId) REFERENCES classrooms(id),
    FOREIGN KEY (studentId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    type TEXT CHECK(type IN ('exam', 'assignment')) NOT NULL,
    classroomId INTEGER NOT NULL,
    joinCode TEXT UNIQUE NOT NULL,
    duration INTEGER,
    deadline DATETIME,
    questions TEXT NOT NULL, -- JSON string
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (classroomId) REFERENCES classrooms(id)
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activityId INTEGER NOT NULL,
    studentId INTEGER NOT NULL,
    answers TEXT NOT NULL, -- JSON string
    evaluatedAnswers TEXT, -- JSON string
    totalScore REAL DEFAULT 0,
    status TEXT CHECK(status IN ('draft', 'submitted', 'evaluated', 'manual_review', 'late_submission')) DEFAULT 'submitted',
    reevaluationCount INTEGER DEFAULT 0,
    humanEvalRequested INTEGER DEFAULT 0,
    manualGrade REAL,
    manualFeedback TEXT,
    submittedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (activityId) REFERENCES activities(id),
    FOREIGN KEY (studentId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    message TEXT NOT NULL,
    read INTEGER DEFAULT 0,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id)
  );
`);

// Migration: Add new columns if they don't exist
const submissionsColumns = [
  { name: 'reevaluationCount', type: 'INTEGER DEFAULT 0' },
  { name: 'humanEvalRequested', type: 'INTEGER DEFAULT 0' },
  { name: 'manualGrade', type: 'REAL' },
  { name: 'manualFeedback', type: 'TEXT' }
];

for (const col of submissionsColumns) {
  try {
    db.prepare(`SELECT ${col.name} FROM submissions LIMIT 1`).get();
  } catch (e) {
    try {
      db.exec(`ALTER TABLE submissions ADD COLUMN ${col.name} ${col.type}`);
    } catch (err) {
      console.error(`Migration failed for submissions.${col.name}:`, err);
    }
  }
}

const usersColumns = [
  { name: 'securityQuestion', type: 'TEXT' },
  { name: 'securityAnswer', type: 'TEXT' }
];

for (const col of usersColumns) {
  try {
    db.prepare(`SELECT ${col.name} FROM users LIMIT 1`).get();
  } catch (e) {
    try {
      db.exec(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type}`);
    } catch (err) {
      console.error(`Migration failed for users.${col.name}:`, err);
    }
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // Auth Middleware
  const authenticate = (req: any, res: any, next: any) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "Unauthorized" });
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      req.user = decoded;
      next();
    } catch (err) {
      res.status(401).json({ message: "Invalid token" });
    }
  };

  const isTeacher = (req: any, res: any, next: any) => {
    if (req.user.role !== "teacher") return res.status(403).json({ message: "Teacher only" });
    next();
  };

  // --- API Routes ---

  // Config check
  app.get("/api/config/check", (req, res) => {
    res.json({
      groqConfigured: !!process.env.GROQ_API_KEY,
      geminiConfigured: !!(process.env.GEMINI_API_KEY || process.env.API_KEY)
    });
  });

  // Auth
  app.post("/api/auth/register", async (req, res) => {
    const { name, email, password, role, securityQuestion, securityAnswer } = req.body;
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const hashedAnswer = securityAnswer ? await bcrypt.hash(securityAnswer.toLowerCase().trim(), 10) : null;
      const stmt = db.prepare("INSERT INTO users (name, email, password, role, securityQuestion, securityAnswer) VALUES (?, ?, ?, ?, ?, ?)");
      stmt.run(name, email, hashedPassword, role, securityQuestion, hashedAnswer);
      res.status(201).json({ message: "User registered" });
    } catch (err: any) {
      console.error("Registration error:", err);
      res.status(400).json({ message: err.message.includes("UNIQUE") ? "Email already exists" : "Registration failed" });
    }
  });

  app.post("/api/auth/forgot-password", async (req, res) => {
    const { email } = req.body;
    try {
      const user = db.prepare("SELECT securityQuestion FROM users WHERE email = ?").get(email) as any;
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json({ securityQuestion: user.securityQuestion });
    } catch (err) {
      res.status(500).json({ message: "Error fetching security question" });
    }
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    const { email, securityAnswer, newPassword } = req.body;
    try {
      const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
      if (!user) return res.status(404).json({ message: "User not found" });

      if (!user.securityAnswer) return res.status(400).json({ message: "No security answer set for this user" });

      const isAnswerCorrect = await bcrypt.compare(securityAnswer.toLowerCase().trim(), user.securityAnswer);
      if (!isAnswerCorrect) return res.status(400).json({ message: "Incorrect security answer" });

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashedPassword, user.id);
      res.json({ message: "Password reset successfully" });
    } catch (err) {
      res.status(500).json({ message: "Error resetting password" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    try {
      const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
      if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: "7d" });
      res.json({ token, user: { id: user.id, name: user.name, role: user.role, email: user.email } });
    } catch (err: any) {
      console.error("Login error:", err);
      res.status(500).json({ message: "Login failed" });
    }
  });

  // Classrooms
  app.get("/api/classrooms", authenticate, (req: any, res) => {
    let classrooms;
    if (req.user.role === "teacher") {
      classrooms = db.prepare(`
        SELECT c.*, u.name as teacherName 
        FROM classrooms c 
        JOIN users u ON c.teacherId = u.id 
        WHERE c.teacherId = ?
      `).all(req.user.id);
    } else {
      classrooms = db.prepare(`
        SELECT c.*, u.name as teacherName 
        FROM classrooms c 
        JOIN users u ON c.teacherId = u.id 
        JOIN classroom_students cs ON c.id = cs.classroomId 
        WHERE cs.studentId = ?
      `).all(req.user.id);
    }
    res.json(classrooms.map((c: any) => ({ ...c, _id: c.id, teacher: { name: c.teacherName } })));
  });

  app.get("/api/classrooms/:id", authenticate, (req, res) => {
    const classroom = db.prepare(`
      SELECT c.*, u.name as teacherName 
      FROM classrooms c 
      JOIN users u ON c.teacherId = u.id 
      WHERE c.id = ?
    `).get(req.params.id) as any;
    if (!classroom) return res.status(404).json({ message: "Classroom not found" });
    res.json({ ...classroom, _id: classroom.id, teacher: { name: classroom.teacherName } });
  });

  app.post("/api/classrooms", authenticate, isTeacher, (req: any, res) => {
    const { name } = req.body;
    const joinCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    const stmt = db.prepare("INSERT INTO classrooms (name, teacherId, joinCode) VALUES (?, ?, ?)");
    const info = stmt.run(name, req.user.id, joinCode);
    res.status(201).json({ id: info.lastInsertRowid, name, teacherId: req.user.id, joinCode });
  });

  // Activities
  app.get("/api/activities/:classId", authenticate, (req, res) => {
    const activities = db.prepare("SELECT * FROM activities WHERE classroomId = ?").all(req.params.classId) as any[];
    res.json(activities.map(a => ({ ...a, _id: a.id, questions: JSON.parse(a.questions) })));
  });

  app.get("/api/activities/all", authenticate, isTeacher, (req: any, res) => {
    const activities = db.prepare(`
      SELECT a.*, c.name as classroomName
      FROM activities a
      JOIN classrooms c ON a.classroomId = c.id
      WHERE c.teacherId = ?
      ORDER BY a.createdAt DESC
    `).all(req.user.id);
    res.json(activities.map((a: any) => ({ 
      ...a, 
      _id: a.id, 
      questions: JSON.parse(a.questions) 
    })));
  });

  app.get("/api/activities/detail/:id", authenticate, (req: any, res) => {
    const activity = db.prepare("SELECT * FROM activities WHERE id = ?").get(req.params.id) as any;
    if (!activity) return res.status(404).json({ message: "Activity not found" });

    // If student, check if already submitted
    if (req.user.role === 'student') {
      const existingSubmission = db.prepare("SELECT id FROM submissions WHERE activityId = ? AND studentId = ?").get(req.params.id, req.user.id);
      if (existingSubmission) {
        return res.status(403).json({ message: "You have already submitted this activity." });
      }
    }

    res.json({ ...activity, _id: activity.id, questions: JSON.parse(activity.questions) });
  });

  app.post("/api/activities", authenticate, isTeacher, (req: any, res) => {
    const { title, type, classroom, duration, deadline, questions } = req.body;
    const joinCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    const stmt = db.prepare("INSERT INTO activities (title, type, classroomId, joinCode, duration, deadline, questions) VALUES (?, ?, ?, ?, ?, ?, ?)");
    const info = stmt.run(title, type, classroom, joinCode, duration || null, deadline || null, JSON.stringify(questions));
    res.status(201).json({ id: info.lastInsertRowid, title, joinCode });
  });

  app.post("/api/activities/join", authenticate, (req: any, res) => {
    const { code } = req.body;
    
    // Check if it's an activity code
    const activity = db.prepare("SELECT * FROM activities WHERE joinCode = ?").get(code) as any;
    if (activity) {
      const exists = db.prepare("SELECT * FROM classroom_students WHERE classroomId = ? AND studentId = ?")
        .get(activity.classroomId, req.user.id);
      
      if (!exists) {
        db.prepare("INSERT INTO classroom_students (classroomId, studentId) VALUES (?, ?)").run(activity.classroomId, req.user.id);
      }
      return res.json({ ...activity, _id: activity.id, type: 'activity' });
    }

    // Check if it's a classroom code
    const classroom = db.prepare("SELECT * FROM classrooms WHERE joinCode = ?").get(code) as any;
    if (classroom) {
      const exists = db.prepare("SELECT * FROM classroom_students WHERE classroomId = ? AND studentId = ?")
        .get(classroom.id, req.user.id);
      
      if (!exists) {
        db.prepare("INSERT INTO classroom_students (classroomId, studentId) VALUES (?, ?)").run(classroom.id, req.user.id);
      }
      return res.json({ ...classroom, _id: classroom.id, title: classroom.name, type: 'classroom' });
    }

    res.status(404).json({ message: "Invalid join code" });
  });

  // Submissions
  app.post("/api/submissions", authenticate, async (req: any, res) => {
    const { activityId, answers } = req.body;
    const activity = db.prepare("SELECT * FROM activities WHERE id = ?").get(activityId) as any;
    if (!activity) return res.status(404).json({ message: "Activity not found" });

    // Check for existing submission
    const existingSubmission = db.prepare("SELECT id FROM submissions WHERE activityId = ? AND studentId = ?").get(activityId, req.user.id);
    if (existingSubmission) {
      return res.status(400).json({ message: "You have already submitted this activity." });
    }

    // Check for deadline
    if (activity.deadline && new Date() > new Date(activity.deadline)) {
      db.prepare("INSERT INTO submissions (activityId, studentId, answers, status) VALUES (?, ?, ?, ?)")
        .run(activityId, req.user.id, JSON.stringify(answers), 'late_submission');
      return res.status(400).json({ message: "Submission rejected: Deadline has passed." });
    }

    const questions = JSON.parse(activity.questions);

    // Perform Evaluation
    try {
      const evaluatedAnswers = await Promise.all(answers.map(async (ans: any) => {
        const question = questions.find((q: any, idx: number) => (q._id || idx.toString()) === ans.questionId);
        if (!question) return ans;
        
        const evalResult = await evaluateAnswer(
          question.text, 
          question.referenceAnswer, 
          ans.answerText, 
          question.maxMarks,
          question.minWords || 0,
          question.maxWords || 0
        );
        return { ...ans, ...evalResult };
      }));

      const totalScore = evaluatedAnswers.reduce((sum, ans) => sum + (ans.score || 0), 0);
      
      const stmt = db.prepare("INSERT INTO submissions (activityId, studentId, answers, evaluatedAnswers, totalScore, status) VALUES (?, ?, ?, ?, ?, ?)");
      const info = stmt.run(activityId, req.user.id, JSON.stringify(answers), JSON.stringify(evaluatedAnswers), totalScore, 'evaluated');

      // Notify Teacher
      const classroom = db.prepare("SELECT * FROM classrooms WHERE id = ?").get(activity.classroomId) as any;
      if (classroom) {
        db.prepare("INSERT INTO notifications (userId, message) VALUES (?, ?)")
          .run(classroom.teacherId, `New submission for ${activity.title} by ${req.user.name}`);
      }

      res.status(201).json({ id: info.lastInsertRowid, totalScore });
    } catch (error: any) {
      if (error.message === 'INVALID_API_KEY') {
        return res.status(401).json({ message: "INVALID_API_KEY" });
      }
      console.error("Evaluation error:", error);
      res.status(500).json({ message: "Evaluation failed" });
    }
  });

  app.post("/api/submissions/:id/re-evaluate", authenticate, async (req: any, res) => {
    const submissionId = req.params.id;
    const submission = db.prepare("SELECT * FROM submissions WHERE id = ?").get(submissionId) as any;
    if (!submission) return res.status(404).json({ message: "Submission not found" });

    if (submission.reevaluationCount >= 1) {
      return res.status(400).json({ message: "Re-evaluation is only allowed once per student." });
    }

    const activity = db.prepare("SELECT * FROM activities WHERE id = ?").get(submission.activityId) as any;
    if (!activity) return res.status(404).json({ message: "Activity not found" });

    if (req.user.role !== 'teacher' && submission.studentId !== req.user.id) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const questions = JSON.parse(activity.questions);
    const answers = JSON.parse(submission.answers);

    try {
      const evaluatedAnswers = await Promise.all(answers.map(async (ans: any) => {
        const question = questions.find((q: any, idx: number) => (q._id || idx.toString()) === ans.questionId);
        if (!question) return ans;
        
        const evalResult = await evaluateAnswer(
          question.text, 
          question.referenceAnswer, 
          ans.answerText, 
          question.maxMarks,
          question.minWords || 0,
          question.maxWords || 0
        );
        return { ...ans, ...evalResult };
      }));

      const newTotalScore = evaluatedAnswers.reduce((sum, ans) => sum + (ans.score || 0), 0);
      const originalScore = submission.totalScore || 0;
      
      // Pick the higher mark
      const isNewScoreHigher = newTotalScore > originalScore;
      const finalScore = Math.max(originalScore, newTotalScore);
      const finalEvaluatedAnswers = isNewScoreHigher ? evaluatedAnswers : JSON.parse(submission.evaluatedAnswers);
      
      db.prepare("UPDATE submissions SET evaluatedAnswers = ?, totalScore = ?, status = ?, reevaluationCount = reevaluationCount + 1 WHERE id = ?")
        .run(JSON.stringify(finalEvaluatedAnswers), finalScore, 'evaluated', submissionId);

      // Notify Teacher
      const classroom = db.prepare("SELECT * FROM classrooms WHERE id = ?").get(activity.classroomId) as any;
      if (classroom) {
        db.prepare("INSERT INTO notifications (userId, message) VALUES (?, ?)")
          .run(classroom.teacherId, `Student ${req.user.name} requested and received an AI re-evaluation for ${activity.title}. Final Score: ${finalScore}`);
      }

      res.json({ 
        message: "Re-evaluation complete", 
        totalScore: finalScore, 
        evaluatedAnswers: finalEvaluatedAnswers,
        isNewScoreHigher
      });
    } catch (error: any) {
      if (error.message === 'INVALID_API_KEY') {
        return res.status(401).json({ message: "INVALID_API_KEY" });
      }
      console.error("Re-evaluation error:", error);
      res.status(500).json({ message: "Re-evaluation failed" });
    }
  });

  app.post("/api/submissions/:id/request-human-eval", authenticate, (req: any, res) => {
    const submissionId = req.params.id;
    const submission = db.prepare("SELECT * FROM submissions WHERE id = ?").get(submissionId) as any;
    if (!submission) return res.status(404).json({ message: "Submission not found" });
    
    if (submission.studentId !== req.user.id) return res.status(403).json({ message: "Unauthorized" });
    if (submission.status !== 'evaluated') return res.status(400).json({ message: "Can only request human evaluation after AI evaluation." });

    db.prepare("UPDATE submissions SET humanEvalRequested = 1 WHERE id = ?").run(submissionId);

    // Notify Teacher
    const activity = db.prepare("SELECT * FROM activities WHERE id = ?").get(submission.activityId) as any;
    const classroom = db.prepare("SELECT * FROM classrooms WHERE id = ?").get(activity.classroomId) as any;
    if (classroom) {
      db.prepare("INSERT INTO notifications (userId, message) VALUES (?, ?)")
        .run(classroom.teacherId, `Student ${req.user.name} has requested a HUMAN evaluation for ${activity.title}.`);
    }

    res.json({ message: "Human evaluation requested successfully." });
  });

  app.post("/api/submissions/:id/manual-grade", authenticate, isTeacher, (req: any, res) => {
    const { grade, feedback } = req.body;
    const submissionId = req.params.id;
    
    db.prepare("UPDATE submissions SET manualGrade = ?, manualFeedback = ?, totalScore = ?, status = ?, humanEvalRequested = 0 WHERE id = ?")
      .run(grade, feedback, grade, 'evaluated', submissionId);

    // Notify Student
    const submission = db.prepare("SELECT * FROM submissions WHERE id = ?").get(submissionId) as any;
    const activity = db.prepare("SELECT * FROM activities WHERE id = ?").get(submission.activityId) as any;
    db.prepare("INSERT INTO notifications (userId, message) VALUES (?, ?)")
      .run(submission.studentId, `Your request for human evaluation for ${activity.title} has been completed. New Score: ${grade}`);

    res.json({ message: "Manual grade saved successfully." });
  });

  app.get("/api/submissions/teacher/requests", authenticate, isTeacher, (req: any, res) => {
    const requests = db.prepare(`
      SELECT s.*, u.name as studentName, a.title as activityTitle
      FROM submissions s
      JOIN users u ON s.studentId = u.id
      JOIN activities a ON s.activityId = a.id
      JOIN classrooms c ON a.classroomId = c.id
      WHERE c.teacherId = ? AND s.humanEvalRequested = 1
    `).all(req.user.id);
    res.json(requests.map((r: any) => ({ ...r, _id: r.id })));
  });

  app.get("/api/submissions/student/report", authenticate, (req: any, res) => {
    const report = db.prepare(`
      SELECT s.*, a.title as activityTitle, a.type as activityType, a.questions as activityQuestions
      FROM submissions s
      JOIN activities a ON s.activityId = a.id
      WHERE s.studentId = ?
    `).all(req.user.id);

    const formattedReport = report.map((r: any) => {
      const questions = JSON.parse(r.activityQuestions);
      const maxPossibleMarks = questions.reduce((acc: number, curr: any) => acc + (curr.maxMarks || 10), 0);
      return {
        id: r.id,
        activityId: r.activityId,
        activityTitle: r.activityTitle,
        activityType: r.activityType,
        totalScore: r.totalScore,
        maxPossibleMarks,
        status: r.status,
        submittedAt: r.submittedAt
      };
    });

    res.json(formattedReport);
  });

  app.get("/api/submissions/teacher/export/:activityId", authenticate, isTeacher, (req: any, res) => {
    const activityId = req.params.activityId;
    const submissions = db.prepare(`
      SELECT s.*, u.name as studentName, u.email as studentEmail
      FROM submissions s
      JOIN users u ON s.studentId = u.id
      WHERE s.activityId = ?
    `).all(activityId);

    const activity = db.prepare("SELECT title, questions FROM activities WHERE id = ?").get(activityId) as any;
    const questions = JSON.parse(activity.questions);
    const maxPossibleMarks = questions.reduce((acc: number, curr: any) => acc + (curr.maxMarks || 10), 0);

    // Generate CSV
    let csv = "Student Name,Email,Score,Total Possible,Submitted Time\n";
    submissions.forEach((s: any) => {
      const submittedTime = s.submittedAt ? new Date(s.submittedAt).toLocaleString() : 'N/A';
      csv += `"${s.studentName}","${s.studentEmail}",${s.totalScore},${maxPossibleMarks},"${submittedTime}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=results_${activity.title.replace(/\s+/g, '_')}.csv`);
    res.send(csv);
  });

  app.get("/api/submissions/activity/:activityId", authenticate, (req: any, res) => {
    let submissions;
    if (req.user.role === "teacher") {
      submissions = db.prepare(`
        SELECT s.*, u.name as studentName, u.email as studentEmail 
        FROM submissions s 
        JOIN users u ON s.studentId = u.id 
        WHERE s.activityId = ?
      `).all(req.params.activityId);
    } else {
      submissions = db.prepare(`
        SELECT s.*, u.name as studentName, u.email as studentEmail 
        FROM submissions s 
        JOIN users u ON s.studentId = u.id 
        WHERE s.activityId = ? AND s.studentId = ?
      `).all(req.params.activityId, req.user.id);
    }
    res.json(submissions.map((s: any) => ({ 
      ...s, 
      _id: s.id, 
      answers: JSON.parse(s.answers),
      evaluatedAnswers: s.evaluatedAnswers ? JSON.parse(s.evaluatedAnswers) : [],
      student: { name: s.studentName, email: s.studentEmail } 
    })));
  });

  app.post("/api/submissions/:id/reevaluate", authenticate, async (req: any, res) => {
    const submissionId = req.params.id;
    const submission = db.prepare(`
      SELECT s.*, a.classroomId, c.teacherId, a.title as activityTitle, u.name as studentName
      FROM submissions s
      JOIN activities a ON s.activityId = a.id
      JOIN classrooms c ON a.classroomId = c.id
      JOIN users u ON s.studentId = u.id
      WHERE s.id = ?
    `).get(submissionId) as any;
    
    if (!submission) return res.status(404).json({ message: "Submission not found" });
    
    // Check if user is authorized (student can re-evaluate their own, teacher can re-evaluate any)
    if (req.user.role !== 'teacher' && submission.studentId !== req.user.id) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Limit re-evaluation to once per student (if not a teacher)
    if (req.user.role === 'student' && (submission.reevaluationCount || 0) >= 1) {
      return res.status(400).json({ message: "Re-evaluation limit reached (max 1 per student)" });
    }

    const activity = db.prepare("SELECT * FROM activities WHERE id = ?").get(submission.activityId) as any;
    const questions = JSON.parse(activity.questions);
    const answers = JSON.parse(submission.answers);

    // Re-perform Evaluation
    try {
      const evaluatedAnswers = await Promise.all(answers.map(async (ans: any) => {
        const question = questions.find((q: any, idx: number) => (q._id || idx.toString()) === ans.questionId);
        if (!question) return ans;
        
        const evalResult = await evaluateAnswer(
          question.text, 
          question.referenceAnswer, 
          ans.answerText, 
          question.maxMarks,
          question.minWords || 0,
          question.maxWords || 0
        );
        return { ...ans, ...evalResult };
      }));

      const newTotalScore = evaluatedAnswers.reduce((sum, ans) => sum + (ans.score || 0), 0);
      const originalScore = submission.totalScore || 0;
      
      // Pick the higher mark
      const finalScore = Math.max(originalScore, newTotalScore);
      const finalEvaluatedAnswers = finalScore === newTotalScore ? evaluatedAnswers : JSON.parse(submission.evaluatedAnswers);
      
      db.prepare("UPDATE submissions SET evaluatedAnswers = ?, totalScore = ?, reevaluationCount = (reevaluationCount + 1) WHERE id = ?")
        .run(JSON.stringify(finalEvaluatedAnswers), finalScore, submissionId);

      // Notify the teacher
      db.prepare("INSERT INTO notifications (userId, message) VALUES (?, ?)")
        .run(submission.teacherId, `Student ${submission.studentName} requested and received a re-evaluation for "${submission.activityTitle}". Final score: ${finalScore}`);

      res.json({ 
        message: "Re-evaluation complete", 
        totalScore: finalScore, 
        evaluatedAnswers: finalEvaluatedAnswers,
        isNewScoreHigher: newTotalScore > originalScore 
      });
    } catch (error: any) {
      if (error.message === 'INVALID_API_KEY') {
        return res.status(401).json({ message: "INVALID_API_KEY" });
      }
      console.error("Re-evaluation error:", error);
      res.status(500).json({ message: "Re-evaluation failed" });
    }
  });

  // Notifications
  app.get("/api/notifications", authenticate, (req: any, res) => {
    const notifications = db.prepare("SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC LIMIT 10").all(req.user.id);
    res.json(notifications.map((n: any) => ({ ...n, _id: n.id })));
  });

  function calculateJaccardSimilarity(str1: string, str2: string) {
  const words1 = new Set(str1.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(str2.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  return intersection.size / union.size;
}

// Plagiarism Check
app.get("/api/plagiarism/:activityId", authenticate, isTeacher, async (req: any, res) => {
  try {
    const submissions = db.prepare(`
      SELECT s.*, u.name as studentName 
      FROM submissions s 
      JOIN users u ON s.studentId = u.id 
      WHERE s.activityId = ?
    `).all(req.params.activityId) as any[];

    if (submissions.length < 2) {
      return res.json({ matches: [] });
    }

    const activity = db.prepare("SELECT * FROM activities WHERE id = ?").get(req.params.activityId) as any;
    const questions = JSON.parse(activity.questions);
    const threshold = parseFloat(req.query.threshold as string) || 0.50;

    const results: any[] = [];

    for (let qIdx = 0; qIdx < questions.length; qIdx++) {
      const questionId = questions[qIdx]._id || qIdx.toString();
      const studentAnswers: { studentName: string, answerText: string, embeddings?: number[] }[] = [];

      for (const sub of submissions) {
        const answers = JSON.parse(sub.answers);
        const ans = answers.find((a: any) => a.questionId === questionId);
        if (ans && ans.answerText && ans.answerText.trim().length > 10) {
          studentAnswers.push({
            studentName: sub.studentName,
            answerText: ans.answerText
          });
        }
      }

      if (studentAnswers.length < 2) continue;

      // Generate embeddings for all answers for this question
      for (const sa of studentAnswers) {
        sa.embeddings = await getEmbeddings(sa.answerText);
      }

      // Compare all pairs
      for (let i = 0; i < studentAnswers.length; i++) {
        for (let j = i + 1; j < studentAnswers.length; j++) {
          const cosineSim = calculateCosineSimilarity(studentAnswers[i].embeddings!, studentAnswers[j].embeddings!);
          const jaccardSim = calculateJaccardSimilarity(studentAnswers[i].answerText, studentAnswers[j].answerText);
          
          // Weighted average: SBERT is good for semantic, Jaccard is good for exact word matches
          // We give more weight to SBERT but Jaccard helps catch direct copy-pastes
          const combinedSimilarity = (cosineSim * 0.7) + (jaccardSim * 0.3);

          if (combinedSimilarity >= threshold) {
            results.push({
              questionTitle: questions[qIdx].text,
              student1: studentAnswers[i].studentName,
              student2: studentAnswers[j].studentName,
              similarity: parseFloat(combinedSimilarity.toFixed(4)),
              cosineSim: parseFloat(cosineSim.toFixed(4)),
              jaccardSim: parseFloat(jaccardSim.toFixed(4)),
              answer1: studentAnswers[i].answerText,
              answer2: studentAnswers[j].answerText
            });
          }
        }
      }
    }

    res.json({ matches: results });
  } catch (error) {
    console.error("Plagiarism check error:", error);
    res.status(500).json({ message: "Plagiarism check failed" });
  }
});

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        hmr: false
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
