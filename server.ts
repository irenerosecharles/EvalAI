import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import cors from "cors";
import Database from "better-sqlite3";
import { evaluateAnswer } from "./src/services/evaluationService.ts";

console.log("GEMINI_API_KEY present:", !!process.env.GEMINI_API_KEY);
console.log("API_KEY present:", !!process.env.API_KEY);

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
    status TEXT CHECK(status IN ('draft', 'submitted', 'evaluated')) DEFAULT 'submitted',
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

// Migration: Add evaluatedAnswers if it doesn't exist
try {
  db.prepare("SELECT evaluatedAnswers FROM submissions LIMIT 1").get();
} catch (e) {
  try {
    db.exec("ALTER TABLE submissions ADD COLUMN evaluatedAnswers TEXT");
  } catch (err) {
    console.error("Migration failed:", err);
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

  // Auth
  app.post("/api/auth/register", async (req, res) => {
    const { name, email, password, role } = req.body;
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const stmt = db.prepare("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)");
      stmt.run(name, email, hashedPassword, role);
      res.status(201).json({ message: "User registered" });
    } catch (err: any) {
      console.error("Registration error:", err);
      res.status(400).json({ message: err.message.includes("UNIQUE") ? "Email already exists" : "Registration failed" });
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

  app.get("/api/activities/detail/:id", authenticate, (req, res) => {
    const activity = db.prepare("SELECT * FROM activities WHERE id = ?").get(req.params.id) as any;
    if (!activity) return res.status(404).json({ message: "Activity not found" });
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

    const questions = JSON.parse(activity.questions);

    // Perform Evaluation
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
  });

  app.post("/api/submissions/:id/re-evaluate", authenticate, async (req: any, res) => {
    const submissionId = req.params.id;
    const submission = db.prepare("SELECT * FROM submissions WHERE id = ?").get(submissionId) as any;
    if (!submission) return res.status(404).json({ message: "Submission not found" });

    const activity = db.prepare("SELECT * FROM activities WHERE id = ?").get(submission.activityId) as any;
    if (!activity) return res.status(404).json({ message: "Activity not found" });

    const classroom = db.prepare("SELECT * FROM classrooms WHERE id = ?").get(activity.classroomId) as any;
    
    if (req.user.role !== 'teacher' && submission.studentId !== req.user.id) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const questions = JSON.parse(activity.questions);
    const answers = JSON.parse(submission.answers);

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
    
    db.prepare("UPDATE submissions SET evaluatedAnswers = ?, totalScore = ?, status = ? WHERE id = ?")
      .run(JSON.stringify(evaluatedAnswers), totalScore, 'evaluated', submissionId);

    res.json({ message: "Re-evaluation complete", totalScore });
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
    const submission = db.prepare("SELECT * FROM submissions WHERE id = ?").get(submissionId) as any;
    
    if (!submission) return res.status(404).json({ message: "Submission not found" });
    if (req.user.role !== 'teacher' && submission.studentId !== req.user.id) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const activity = db.prepare("SELECT * FROM activities WHERE id = ?").get(submission.activityId) as any;
    const questions = JSON.parse(activity.questions);
    const answers = JSON.parse(submission.answers);

    // Re-perform Evaluation
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
    
    db.prepare("UPDATE submissions SET evaluatedAnswers = ?, totalScore = ? WHERE id = ?")
      .run(JSON.stringify(evaluatedAnswers), totalScore, submissionId);

    res.json({ message: "Re-evaluation complete", totalScore, evaluatedAnswers });
  });

  // Notifications
  app.get("/api/notifications", authenticate, (req: any, res) => {
    const notifications = db.prepare("SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC LIMIT 10").all(req.user.id);
    res.json(notifications.map((n: any) => ({ ...n, _id: n.id })));
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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
