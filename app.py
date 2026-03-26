import streamlit as st
import sqlite3
import hashlib
import json
import time
import pandas as pd
from datetime import datetime
import google.generativeai as genai
from sentence_transformers import SentenceTransformer, util
import os

# --- Configuration ---
st.set_page_layout = "wide"
st.title("EvalAI - Academic Evaluation Portal")

# Initialize Gemini
if "GEMINI_API_KEY" in os.environ:
    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    model = genai.GenerativeModel('gemini-1.5-flash')
else:
    st.warning("Gemini API Key not found in environment variables. Feedback features will be limited.")

# Initialize BERT
@st.cache_resource
def load_bert():
    return SentenceTransformer('all-MiniLM-L6-v2')

bert_model = load_bert()

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

def evaluate_answer(question, reference, student_answer, max_marks):
    if not reference or reference.strip() == "":
        return 1.0, 1.0, max_marks, "Accepted without reference.", "N/A", "N/A"
    
    # Word Count Analysis
    ref_words = len(reference.split())
    stu_words = len(student_answer.split())
    
    # BERT Similarity
    ref_emb = bert_model.encode(reference, convert_to_tensor=True)
    stu_emb = bert_model.encode(student_answer, convert_to_tensor=True)
    cosine_scores = util.cos_sim(ref_emb, stu_emb)
    semantic_similarity = float(cosine_scores[0][0])
    
    # Gemini Feedback & Completeness
    feedback = "Good attempt."
    strengths = "Relevant content."
    improvements = "Elaborate more."
    grammar_score = 0.8
    completeness_score = 0.8
    
    if "GEMINI_API_KEY" in os.environ:
        try:
            prompt = f"""
            Evaluate student answer for:
            Question: {question}
            Reference: {reference} (Words: {ref_words})
            Student Answer: {student_answer} (Words: {stu_words})
            BERT Similarity: {semantic_similarity:.2f}
            
            Provide JSON: {{"grammar_score": 0.0-1.0, "completeness_score": 0.0-1.0, "feedback": "...", "strengths": "...", "improvements": "..."}}
            """
            response = model.generate_content(prompt)
            res_json = json.loads(response.text.replace('```json', '').replace('```', ''))
            grammar_score = res_json.get('grammar_score', 0.8)
            completeness_score = res_json.get('completeness_score', 0.8)
            feedback = res_json.get('feedback', feedback)
            strengths = res_json.get('strengths', strengths)
            improvements = res_json.get('improvements', improvements)
        except:
            pass
    
    # Justifiable Marking Formula
    length_penalty = 0.8 if stu_words < ref_words * 0.4 else 1.0
    weighted_score = (semantic_similarity * 0.60 + completeness_score * 0.25 + grammar_score * 0.15)
    final_score = weighted_score * max_marks * length_penalty
    
    # Boost for high similarity
    if semantic_similarity > 0.85 and completeness_score > 0.8:
        final_score = max(final_score, max_marks * 0.9)
        
    final_score = max(0, min(max_marks, final_score))
    return semantic_similarity, grammar_score, round(final_score, 1), feedback, strengths, improvements

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
    
    tab1, tab2 = st.tabs(["My Classrooms", "Create Activity"])
    
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
                    marks = st.number_input(f"Max Marks {i+1}", 1, 100, 10)
                    questions.append({"text": q_text, "referenceAnswer": ref, "maxMarks": marks})
                
                if st.form_submit_button("Publish Activity"):
                    code = hashlib.md5(title.encode()).hexdigest()[:5].upper()
                    conn = get_db_connection()
                    c = conn.cursor()
                    c.execute("INSERT INTO activities (title, type, classroom_id, join_code, questions) VALUES (?,?,?,?,?)", 
                              (title, 'exam', cls_id, code, json.dumps(questions)))
                    conn.commit()
                    conn.close()
                    st.success(f"Activity Published! Code: {code}")

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
        with st.spinner("Evaluating your answers using BERT & Gemini..."):
            evaluated = []
            total = 0
            for i, q in enumerate(questions):
                sim, gram, score, feed, strn, imp = evaluate_answer(q['text'], q['referenceAnswer'], answers[i], q['maxMarks'])
                evaluated.append({
                    "question": q['text'],
                    "studentAnswer": answers[i],
                    "score": score,
                    "feedback": feed,
                    "strengths": strn,
                    "improvements": imp
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

# --- Main Logic ---
if st.session_state.user is None:
    auth_page()
else:
    if st.sidebar.button("Logout"):
        st.session_state.user = None
        st.rerun()
        
    if 'active_exam' in st.session_state and st.session_state.active_exam:
        exam_interface()
    else:
        if st.session_state.user['role'] == 'teacher':
            teacher_dashboard()
        else:
            student_dashboard()
