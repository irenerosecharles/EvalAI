import streamlit as st
import sqlite3
import hashlib
import json
import time
import pandas as pd
from datetime import datetime
import google.generativeai as genai
import os
from groq import Groq
from sentence_transformers import SentenceTransformer, util
import torch

# --- Configuration ---
st.set_page_layout = "wide"
st.title("EvalAI - Academic Evaluation Portal")

# Cache SBERT model
@st.cache_resource
def load_sbert():
    return SentenceTransformer('all-MiniLM-L6-v2')

# Cache Groq client
@st.cache_resource
def get_groq_client():
    api_key = os.environ.get("GROQ_API_KEY")
    if api_key:
        return Groq(api_key=api_key)
    return None

# Initialize Gemini (as fallback or for ideal answer)
gemini_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("API_KEY")
if gemini_key:
    genai.configure(api_key=gemini_key)
    model = genai.GenerativeModel('gemini-3-flash-preview')
else:
    model = None

# --- Database Setup ---
def init_db():
    conn = sqlite3.connect('evalai_streamlit.db')
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS users 
                 (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT UNIQUE, password TEXT, role TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS classrooms 
                 (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, teacher_id INTEGER, join_code TEXT UNIQUE)''')
    c.execute('''CREATE TABLE IF NOT EXISTS classroom_students 
                 (classroom_id INTEGER, student_id INTEGER)''')
    c.execute('''CREATE TABLE IF NOT EXISTS activities 
                 (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, type TEXT, classroom_id INTEGER, join_code TEXT UNIQUE, questions TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS submissions 
                 (id INTEGER PRIMARY KEY AUTOINCREMENT, activity_id INTEGER, student_id INTEGER, answers TEXT, evaluated_answers TEXT, total_score REAL)''')
    conn.commit()
    conn.close()

init_db()

# --- Helper Functions ---
def hash_password(password):
    return hashlib.sha256(str.encode(password)).hexdigest()

def get_db_connection():
    return sqlite3.connect('evalai_streamlit.db')

def evaluate_answer(question, reference, student_answer, max_marks, min_words=0, max_words=0):
    # Word Count Analysis
    stu_words = len(student_answer.split())
    
    # AI Ideal Answer Generation (using Gemini if available)
    ideal_answer = reference or "No reference provided."
    if model:
        try:
            ideal_prompt = f"As an expert academic, provide a concise, comprehensive, and accurate 'Gold Standard' answer for the following question. Question: {question}. {f'Teacher Hint: {reference}' if reference else ''}. Provide only the answer text."
            ideal_res = model.generate_content(ideal_prompt)
            ideal_answer = ideal_res.text
        except:
            pass
    
    # SBERT Similarity Score
    sbert_model = load_sbert()
    embeddings_stu = sbert_model.encode(student_answer, convert_to_tensor=True)
    embeddings_ref = sbert_model.encode(ideal_answer, convert_to_tensor=True)
    cosine_sim = util.cos_sim(embeddings_stu, embeddings_ref)
    sbert_score = float(cosine_sim[0][0])
    
    # Quality & Feedback using Groq (Primary) or Gemini (Fallback)
    feedback = "Good attempt."
    quality_score = sbert_score # Default to SBERT similarity
    strengths = "N/A"
    improvements = "N/A"
    reasoning = "Evaluated using SBERT similarity."
    
    groq_client = get_groq_client()
    
    if groq_client:
        try:
            prompt = f"""
            You are an expert academic evaluator. A student has answered a question.
            
            Question: {question}
            Ideal Answer: {ideal_answer}
            Student Answer: {student_answer}
            SBERT Similarity Score: {sbert_score:.4f}
            
            Word Count Constraints:
            - Minimum Words Required: {min_words if min_words > 0 else "None"}
            - Maximum Words Allowed: {max_words if max_words > 0 else "None"}
            - Student's Actual Word Count: {stu_words}
            
            Evaluation Rubric (Total 100%):
            1. Content Accuracy (40%): How factually correct is the answer compared to the ideal answer? (Use SBERT score as a guide)
            2. Depth & Detail (30%): Does the student provide sufficient explanation and context?
            3. Structure & Clarity (20%): Is the answer well-organized and easy to understand?
            4. Word Count Adherence (10%): Does the answer meet the length requirements?
            
            Scoring Penalties:
            - If stu_words < ({min_words} * 0.2), Content Accuracy and Depth MUST be capped at 0.
            - If stu_words < ({min_words} * 0.5), Content Accuracy and Depth MUST be capped at 50% of their max.
            - If stu_words > {max_words if max_words > 0 else 999999}, apply a 10% penalty to the final score.
            
            Instructions:
            - Analyze the student's answer against each rubric point.
            - Calculate the final "quality_score" (0.0 to 1.0).
            - Provide specific "strengths" and "improvements".
            - Write a professional "feedback" summary.
            
            Return ONLY a valid JSON object:
            {{"reasoning": "...", "quality_score": 0.0-1.0, "strengths": "...", "improvements": "...", "feedback": "..."}}
            """
            chat_completion = groq_client.chat.completions.create(
                messages=[{"role": "user", "content": prompt}],
                model="llama3-8b-8192",
                response_format={"type": "json_object"}
            )
            res_json = json.loads(chat_completion.choices[0].message.content)
            quality_score = float(res_json.get('quality_score', sbert_score))
            strengths = res_json.get('strengths', strengths)
            improvements = res_json.get('improvements', improvements)
            feedback = res_json.get('feedback', feedback)
            reasoning = res_json.get('reasoning', reasoning)
        except Exception as e:
            print(f"Groq Evaluation Error: {e}")
            # Fallback to Gemini if Groq fails
            if model:
                try:
                    # (Existing Gemini logic here as fallback)
                    response = model.generate_content(prompt)
                    clean_text = response.text.replace('```json', '').replace('```', '').strip()
                    res_json = json.loads(clean_text)
                    quality_score = float(res_json.get('quality_score', sbert_score))
                    strengths = res_json.get('strengths', strengths)
                    improvements = res_json.get('improvements', improvements)
                    feedback = res_json.get('feedback', feedback)
                    reasoning = res_json.get('reasoning', reasoning)
                except:
                    pass
    
    final_score = max(0, min(max_marks, quality_score * max_marks))
    
    return round(final_score, 1), feedback, strengths, improvements, round(sbert_score, 4), reasoning

# --- Session State ---
if 'user' not in st.session_state:
    st.session_state.user = None

# --- Auth UI ---
def auth_page():
    choice = st.sidebar.selectbox("Login/Signup", ["Login", "Sign Up"])
    
    if choice == "Login":
        email = st.text_input("Email")
        password = st.text_input("Password", type='password')
        if st.button("Login"):
            conn = get_db_connection()
            c = conn.cursor()
            c.execute("SELECT * FROM users WHERE email=? AND password=?", (email, hash_password(password)))
            user = c.fetchone()
            conn.close()
            if user:
                st.session_state.user = {"id": user[0], "name": user[1], "email": user[2], "role": user[4]}
                st.rerun()
            else:
                st.error("Invalid credentials")
                
    else:
        name = st.text_input("Full Name")
        email = st.text_input("Email")
        password = st.text_input("Password", type='password')
        role = st.selectbox("Role", ["teacher", "student"])
        if st.button("Create Account"):
            conn = get_db_connection()
            c = conn.cursor()
            try:
                c.execute("INSERT INTO users (name, email, password, role) VALUES (?,?,?,?)", 
                          (name, email, hash_password(password), role))
                conn.commit()
                st.success("Account created! Please login.")
            except:
                st.error("Email already exists")
            conn.close()

# --- Teacher Dashboard ---
def teacher_dashboard():
    st.header(f"Welcome, Prof. {st.session_state.user['name']}")
    
    tab1, tab2, tab3 = st.tabs(["My Classrooms", "Create Activity", "Plagiarism Check"])
    
    with tab1:
        conn = get_db_connection()
        df = pd.read_sql_query("SELECT * FROM classrooms WHERE teacher_id=?", conn, params=(st.session_state.user['id'],))
        conn.close()
        
        if df.empty:
            st.info("No classrooms yet.")
        else:
            for _, row in df.iterrows():
                with st.expander(f"🏫 {row['name']} (Code: {row['join_code']})"):
                    st.write("Activities in this class:")
                    conn = get_db_connection()
                    acts = pd.read_sql_query("SELECT * FROM activities WHERE classroom_id=?", conn, params=(row['id'],))
                    conn.close()
                    if acts.empty:
                        st.write("No activities.")
                    else:
                        st.dataframe(acts[['title', 'join_code']])
        
        if st.button("➕ Create New Classroom"):
            with st.form("new_class"):
                name = st.text_input("Class Name")
                if st.form_submit_button("Create"):
                    code = hashlib.md5(name.encode()).hexdigest()[:5].upper()
                    conn = get_db_connection()
                    c = conn.cursor()
                    c.execute("INSERT INTO classrooms (name, teacher_id, join_code) VALUES (?,?,?)", 
                               (name, st.session_state.user['id'], code))
                    conn.commit()
                    conn.close()
                    st.rerun()

    with tab2:
        conn = get_db_connection()
        classes = pd.read_sql_query("SELECT id, name FROM classrooms WHERE teacher_id=?", conn, params=(st.session_state.user['id'],))
        conn.close()
        
        if classes.empty:
            st.warning("Create a classroom first!")
        else:
            with st.form("new_act"):
                title = st.text_input("Activity Title")
                cls_id = st.selectbox("Classroom", classes['id'], format_func=lambda x: classes[classes['id']==x]['name'].values[0])
                q_count = st.number_input("Number of Questions", 1, 10, 1)
                questions = []
                for i in range(q_count):
                    st.divider()
                    q_text = st.text_area(f"Question {i+1}")
                    ref = st.text_area(f"Reference Answer {i+1}")
                    c1, c2, c3 = st.columns(3)
                    marks = c1.number_input(f"Max Marks {i+1}", 1, 100, 10)
                    min_w = c2.number_input(f"Min Words {i+1}", 0, 1000, 0)
                    max_w = c3.number_input(f"Max Words {i+1}", 0, 2000, 0)
                    questions.append({"text": q_text, "referenceAnswer": ref, "maxMarks": marks, "minWords": min_w, "maxWords": max_w})
                
                if st.form_submit_button("Publish Activity"):
                    code = hashlib.md5(title.encode()).hexdigest()[:5].upper()
                    conn = get_db_connection()
                    c = conn.cursor()
                    c.execute("INSERT INTO activities (title, type, classroom_id, join_code, questions) VALUES (?,?,?,?,?)", 
                               (title, 'exam', cls_id, code, json.dumps(questions)))
                    conn.commit()
                    conn.close()
                    st.success(f"Activity Published! Code: {code}")

    with tab3:
        st.subheader("Cross-Student Plagiarism Analysis")
        conn = get_db_connection()
        acts = pd.read_sql_query("""
            SELECT a.id, a.title, c.name as classroom 
            FROM activities a 
            JOIN classrooms c ON a.classroom_id = c.id 
            WHERE c.teacher_id = ?
        """, conn, params=(st.session_state.user['id'],))
        conn.close()
        
        if acts.empty:
            st.info("No activities found.")
        else:
            selected_act = st.selectbox("Select Activity to Check", acts['id'], format_func=lambda x: f"{acts[acts['id']==x]['title'].values[0]} ({acts[acts['id']==x]['classroom'].values[0]})")
            threshold = st.slider("Similarity Threshold", 0.5, 1.0, 0.85)
            
            if st.button("Run Plagiarism Check"):
                with st.spinner("Analyzing submissions using SBERT..."):
                    conn = get_db_connection()
                    subs = pd.read_sql_query("""
                        SELECT s.student_id, u.name, s.answers 
                        FROM submissions s 
                        JOIN users u ON s.student_id = u.id 
                        WHERE s.activity_id = ?
                    """, conn, params=(selected_act,))
                    conn.close()
                    
                    if len(subs) < 2:
                        st.warning("Need at least 2 submissions to compare.")
                    else:
                        sbert_model = load_sbert()
                        results = []
                        
                        # Compare each question across all students
                        num_questions = len(json.loads(subs.iloc[0]['answers']))
                        
                        for q_idx in range(num_questions):
                            student_answers = []
                            student_names = []
                            for _, row in subs.iterrows():
                                ans_list = json.loads(row['answers'])
                                if q_idx < len(ans_list):
                                    student_answers.append(ans_list[q_idx])
                                    student_names.append(row['name'])
                            
                            if len(student_answers) > 1:
                                embeddings = sbert_model.encode(student_answers, convert_to_tensor=True)
                                cosine_matrix = util.cos_sim(embeddings, embeddings)
                                
                                for i in range(len(student_answers)):
                                    for j in range(i + 1, len(student_answers)):
                                        sim = float(cosine_matrix[i][j])
                                        if sim >= threshold:
                                            results.append({
                                                "Question": q_idx + 1,
                                                "Student 1": student_names[i],
                                                "Student 2": student_names[j],
                                                "Similarity": f"{sim:.2%}"
                                            })
                        
                        if results:
                            st.error(f"Found {len(results)} potential plagiarism cases!")
                            st.table(pd.DataFrame(results))
                        else:
                            st.success("No plagiarism detected above the threshold.")

# --- Student Dashboard ---
def student_dashboard():
    st.header(f"Student Portal: {st.session_state.user['name']}")
    
    code = st.sidebar.text_input("Join with Code")
    if st.sidebar.button("Join"):
        conn = get_db_connection()
        c = conn.cursor()
        # Check if classroom code
        c.execute("SELECT id FROM classrooms WHERE join_code=?", (code,))
        cls = c.fetchone()
        if cls:
            c.execute("INSERT INTO classroom_students (classroom_id, student_id) VALUES (?,?)", (cls[0], st.session_state.user['id']))
            conn.commit()
            st.success("Joined Classroom!")
        else:
            st.error("Invalid Code")
        conn.close()

    st.subheader("My Activities")
    conn = get_db_connection()
    # Get classrooms student is in
    cls_ids = pd.read_sql_query("SELECT classroom_id FROM classroom_students WHERE student_id=?", conn, params=(st.session_state.user['id'],))
    if not cls_ids.empty:
        ids = tuple(cls_ids['classroom_id'].tolist())
        if len(ids) == 1:
            acts = pd.read_sql_query("SELECT * FROM activities WHERE classroom_id = ?", conn, params=(ids[0],))
        else:
            acts = pd.read_sql_query(f"SELECT * FROM activities WHERE classroom_id IN {ids}", conn)
        
        for _, act in acts.iterrows():
            with st.container(border=True):
                col1, col2 = st.columns([3, 1])
                col1.write(f"📝 **{act['title']}**")
                if col2.button("Start Exam", key=act['id']):
                    st.session_state.active_exam = act['id']
                    st.rerun()
    else:
        st.info("Join a classroom to see activities.")
    conn.close()

# --- Exam Interface ---
def exam_interface():
    act_id = st.session_state.active_exam
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM activities WHERE id=?", (act_id,))
    act = c.fetchone()
    conn.close()
    
    st.header(f"Exam: {act[1]}")
    questions = json.loads(act[5])
    
    answers = []
    for i, q in enumerate(questions):
        st.write(f"**Q{i+1}: {q['text']}** ({q['maxMarks']} Marks)")
        ans = st.text_area(f"Your Answer", key=f"ans_{i}")
        answers.append(ans)
        
    if st.button("Submit Exam"):
        with st.spinner("Evaluating your answers using Gemini AI..."):
            evaluated = []
            total = 0
            for i, q in enumerate(questions):
                score, feed, strn, imp, sbert, reasoning = evaluate_answer(
                    q['text'], 
                    q['referenceAnswer'], 
                    answers[i], 
                    q['maxMarks'],
                    q.get('minWords', 0),
                    q.get('maxWords', 0)
                )
                evaluated.append({
                    "question": q['text'],
                    "studentAnswer": answers[i],
                    "score": score,
                    "feedback": feed,
                    "strengths": strn,
                    "improvements": imp,
                    "sbertScore": sbert,
                    "reasoning": reasoning
                })
                total += score
            
            conn = get_db_connection()
            c = conn.cursor()
            c.execute("INSERT INTO submissions (activity_id, student_id, answers, evaluated_answers, total_score) VALUES (?,?,?,?,?)",
                      (act_id, st.session_state.user['id'], json.dumps(answers), json.dumps(evaluated), total))
            conn.commit()
            conn.close()
            
            st.success(f"Exam Submitted! Total Score: {total}")
            st.session_state.active_exam = None
            time.sleep(3)
            st.rerun()

# --- Results View ---
def results_view(sub_id):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("""SELECT s.*, a.title, a.questions 
                 FROM submissions s 
                 JOIN activities a ON s.activity_id = a.id 
                 WHERE s.id=?""", (sub_id,))
    sub = c.fetchone()
    conn.close()
    
    if not sub:
        st.error("Submission not found")
        return

    st.header(f"Evaluation Report: {sub[6]}")
    
    col1, col2 = st.columns([3, 1])
    with col2:
        st.metric("Total Score", f"{sub[5]}")
        if st.session_state.user['role'] == 'student':
            if st.button("🔄 Request Re-evaluation"):
                with st.spinner("Re-evaluating using Gemini AI..."):
                    questions = json.loads(sub[7])
                    answers = json.loads(sub[3])
                    evaluated = []
                    total = 0
                    for i, q in enumerate(questions):
                        score, feed, strn, imp, sbert, reasoning = evaluate_answer(
                            q['text'], 
                            q['referenceAnswer'], 
                            answers[i], 
                            q['maxMarks'],
                            q.get('minWords', 0),
                            q.get('maxWords', 0)
                        )
                        evaluated.append({
                            "question": q['text'],
                            "studentAnswer": answers[i],
                            "score": score,
                            "feedback": feed,
                            "strengths": strn,
                            "improvements": imp,
                            "sbertScore": sbert,
                            "reasoning": reasoning
                        })
                        total += score
                    
                    conn = get_db_connection()
                    c = conn.cursor()
                    c.execute("UPDATE submissions SET evaluated_answers=?, total_score=? WHERE id=?", 
                              (json.dumps(evaluated), total, sub_id))
                    conn.commit()
                    conn.close()
                    st.success("Re-evaluation complete!")
                    time.sleep(1)
                    st.rerun()

    evaluated_answers = json.loads(sub[4])
    for i, ans in enumerate(evaluated_answers):
        with st.container(border=True):
            st.subheader(f"Question {i+1}")
            st.write(f"**Question:** {ans['question']}")
            st.info(f"**Your Answer:** {ans['studentAnswer']}")
            
            st.write(f"**AI Feedback:** *\"{ans['feedback']}\"*")
            st.write(f"**Score:** {ans['score']}")

# --- Main Logic ---
if st.session_state.user is None:
    auth_page()
else:
    if st.sidebar.button("Logout"):
        st.session_state.user = None
        st.rerun()
        
    if 'active_exam' in st.session_state and st.session_state.active_exam:
        exam_interface()
    elif 'view_results' in st.session_state and st.session_state.view_results:
        if st.sidebar.button("Back to Dashboard"):
            st.session_state.view_results = None
            st.rerun()
        results_view(st.session_state.view_results)
    else:
        if st.session_state.user['role'] == 'teacher':
            teacher_dashboard()
        else:
            student_dashboard()
            
            # Show past submissions
            st.divider()
            st.subheader("My Past Submissions")
            conn = get_db_connection()
            subs = pd.read_sql_query("""SELECT s.id, a.title, s.total_score, s.activity_id 
                                        FROM submissions s 
                                        JOIN activities a ON s.activity_id = a.id 
                                        WHERE s.student_id=?""", conn, params=(st.session_state.user['id'],))
            conn.close()
            if not subs.empty:
                for _, s in subs.iterrows():
                    col1, col2 = st.columns([3, 1])
                    col1.write(f"📊 {s['title']} - Score: {s['total_score']}")
                    if col2.button("View Details", key=f"view_{s['id']}"):
                        st.session_state.view_results = s['id']
                        st.rerun()
