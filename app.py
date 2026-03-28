import streamlit as st
import sqlite3
import hashlib
import json
import time
import pandas as pd
from datetime import datetime
import os
import requests

# --- SBERT Import ---
from sentence_transformers import SentenceTransformer, util

# --- Load SBERT model once (cached so it doesn't reload on every interaction) ---
@st.cache_resource
def load_sbert_model():
    return SentenceTransformer('all-MiniLM-L6-v2')

sbert_model = load_sbert_model()

# --- Configuration ---
st.set_page_config(layout="wide")
st.title("EvalAI - Academic Evaluation Portal")

# --- Groq API Setup ---
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama3-8b-8192"  # Free tier model on Groq


# --- Groq Feedback Generator ---
def generate_feedback_groq(question, reference_answer, student_answer, score, max_marks):
    """
    Calls Groq API (Llama 3) to generate descriptive feedback for a student's answer.
    Falls back to rule-based feedback if Groq is unavailable or key is missing.
    """
    if not GROQ_API_KEY:
        return rule_based_feedback(score, max_marks)

    prompt = f"""You are an academic evaluator. A student has answered a question. 
Based on the question, reference answer, and student's answer, provide structured feedback.

Question: {question}
Reference Answer: {reference_answer if reference_answer else "Not provided"}
Student Answer: {student_answer}
Marks Awarded: {score} out of {max_marks}

Respond ONLY with a valid JSON object in this exact format (no markdown, no explanation):
{{"feedback": "2-3 sentence overall feedback", "strengths": "one sentence on what student did well", "improvements": "one sentence on what student should improve"}}"""

    try:
        headers = {
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": "application/json"
        }
        body = {
            "model": GROQ_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.4,
            "max_tokens": 300
        }
        response = requests.post(GROQ_API_URL, headers=headers, json=body, timeout=15)
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"].strip()
        # Strip markdown code fences if present
        content = content.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(content)
        return parsed.get("feedback", "Good attempt."), parsed.get("strengths", "N/A"), parsed.get("improvements", "N/A")
    except Exception as e:
        # Graceful fallback if Groq fails
        return rule_based_feedback(score, max_marks)


def rule_based_feedback(score, max_marks):
    """
    Generates simple rule-based feedback when Groq is unavailable.
    Based on semantic similarity ratio.
    """
    ratio = score / max_marks if max_marks > 0 else 0
    if ratio >= 0.85:
        feedback = "Excellent answer. Your response closely matches the expected content."
        strengths = "Strong conceptual understanding demonstrated."
        improvements = "Minor elaboration could further strengthen the answer."
    elif ratio >= 0.60:
        feedback = "Good attempt. Some key concepts were covered but a few points were missing."
        strengths = "Partial understanding of the topic shown."
        improvements = "Review the topic more thoroughly and include all key concepts."
    else:
        feedback = "Your answer needs improvement. Please review the topic and key concepts carefully."
        strengths = "An attempt was made to answer the question."
        improvements = "Study the reference material and focus on core ideas."
    return feedback, strengths, improvements


# --- SBERT Evaluation Core ---
def evaluate_answer(question, reference, student_answer, max_marks, min_words=0, max_words=0):
    """
    Evaluates a student's answer using:
    1. SBERT cosine similarity (semantic score) — 75% weight
    2. Grammar/readability via textstat — 25% weight
    3. Groq LLM for feedback text generation
    """
    # --- Handle empty answer ---
    if not student_answer or student_answer.strip() == "":
        feedback, strengths, improvements = "No answer was provided.", "N/A", "Please attempt all questions."
        return 0.0, feedback, strengths, improvements

    # --- Word count check ---
    word_count = len(student_answer.split())

    # --- Step 1: SBERT Semantic Similarity ---
    if reference and reference.strip():
        student_embedding = sbert_model.encode(student_answer, convert_to_tensor=True)
        reference_embedding = sbert_model.encode(reference, convert_to_tensor=True)
        semantic_score = float(util.cos_sim(student_embedding, reference_embedding)[0][0])
        # Clamp to [0, 1] range
        semantic_score = max(0.0, min(1.0, semantic_score))
    else:
        # No reference answer: give benefit of the doubt
        semantic_score = 0.75

    # --- Step 2: Grammar / Readability Score via textstat ---
    try:
        import textstat
        flesch = textstat.flesch_reading_ease(student_answer)
        # Flesch score: 0–100, higher = easier to read (good)
        # Normalize to 0–1: 60–100 is good range
        grammar_score = max(0.0, min(1.0, flesch / 100.0))
    except Exception:
        grammar_score = 0.5  # Neutral fallback

    # --- Step 3: Word count penalty ---
    word_penalty = 1.0
    if min_words > 0 and word_count < min_words:
        # Penalize proportionally
        word_penalty = max(0.1, word_count / min_words)
    if max_words > 0 and word_count > max_words:
        # Slight penalty for exceeding max
        word_penalty = max(0.8, max_words / word_count)

    # --- Step 4: Final score formula ---
    # SBERT: 75%, Grammar: 25%, multiplied by word penalty
    raw_score = (semantic_score * 0.75 + grammar_score * 0.25) * word_penalty
    final_score = round(max(0.0, min(float(max_marks), raw_score * max_marks)), 1)

    # --- Step 5: Groq LLM Feedback ---
    feedback, strengths, improvements = generate_feedback_groq(
        question, reference, student_answer, final_score, max_marks
    )

    return final_score, feedback, strengths, improvements


# --- Plagiarism Check using SBERT Cosine Similarity ---
def run_plagiarism_check(activity_id):
    """
    Compares all student answers for each question in an activity using SBERT cosine similarity.
    Flags pairs of students whose answers are suspiciously similar (similarity >= threshold).
    Returns a list of flagged pairs with details.
    """
    PLAGIARISM_THRESHOLD = 0.88  # Tune this: 0.88 = very similar, lower = more sensitive

    conn = get_db_connection()
    c = conn.cursor()

    # Fetch all submissions for this activity
    c.execute("""
        SELECT s.id, s.student_id, s.answers, u.name 
        FROM submissions s 
        JOIN users u ON s.student_id = u.id 
        WHERE s.activity_id = ?
    """, (activity_id,))
    submissions = c.fetchall()
    conn.close()

    if len(submissions) < 2:
        return [], "Not enough submissions to compare (need at least 2 students)."

    # Parse answers
    parsed = []
    for sub in submissions:
        sub_id, student_id, answers_json, student_name = sub
        try:
            answers = json.loads(answers_json)
        except Exception:
            answers = []
        parsed.append({
            "sub_id": sub_id,
            "student_id": student_id,
            "name": student_name,
            "answers": answers
        })

    flagged_pairs = []
    num_questions = max(len(p["answers"]) for p in parsed)

    # Compare each pair of students
    for i in range(len(parsed)):
        for j in range(i + 1, len(parsed)):
            student_a = parsed[i]
            student_b = parsed[j]
            question_similarities = []

            for q_idx in range(num_questions):
                ans_a = student_a["answers"][q_idx] if q_idx < len(student_a["answers"]) else ""
                ans_b = student_b["answers"][q_idx] if q_idx < len(student_b["answers"]) else ""

                # Skip if either answer is empty
                if not ans_a.strip() or not ans_b.strip():
                    question_similarities.append(0.0)
                    continue

                emb_a = sbert_model.encode(ans_a, convert_to_tensor=True)
                emb_b = sbert_model.encode(ans_b, convert_to_tensor=True)
                sim = float(util.cos_sim(emb_a, emb_b)[0][0])
                sim = max(0.0, min(1.0, sim))
                question_similarities.append(sim)

            # Flag if ANY question similarity is above threshold
            for q_idx, sim in enumerate(question_similarities):
                if sim >= PLAGIARISM_THRESHOLD:
                    flagged_pairs.append({
                        "student_a": student_a["name"],
                        "student_b": student_b["name"],
                        "question_number": q_idx + 1,
                        "similarity": round(sim * 100, 1),  # as percentage
                        "answer_a": student_a["answers"][q_idx] if q_idx < len(student_a["answers"]) else "",
                        "answer_b": student_b["answers"][q_idx] if q_idx < len(student_b["answers"]) else ""
                    })

    return flagged_pairs, None


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
                        for _, act in acts.iterrows():
                            col1, col2, col3 = st.columns([3, 2, 2])
                            col1.write(f"📝 **{act['title']}** (Code: `{act['join_code']}`)")

                            # --- View Results Button ---
                            if col2.button("📊 View Results", key=f"res_{act['id']}"):
                                st.session_state.view_activity_results = act['id']
                                st.rerun()

                            # --- Plagiarism Check Button ---
                            if col3.button("🔍 Plagiarism Check", key=f"plag_{act['id']}"):
                                st.session_state.plagiarism_activity_id = act['id']
                                st.rerun()

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
                    st.success(f"Activity Published! Code: **{code}**")


# --- Plagiarism Report View ---
def plagiarism_view(activity_id):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT title FROM activities WHERE id=?", (activity_id,))
    act = c.fetchone()
    conn.close()

    st.header(f"🔍 Plagiarism Report: {act[0] if act else 'Unknown Activity'}")
    st.info("Comparing all student answers using SBERT cosine similarity. Pairs scoring ≥ 88% similarity are flagged.")

    if st.button("⬅ Back to Dashboard"):
        st.session_state.plagiarism_activity_id = None
        st.rerun()

    with st.spinner("Running SBERT plagiarism analysis across all submissions..."):
        flagged_pairs, error_msg = run_plagiarism_check(activity_id)

    if error_msg:
        st.warning(error_msg)
        return

    if not flagged_pairs:
        st.success("✅ No suspicious similarities detected. All answers appear original.")
        return

    st.error(f"⚠️ {len(flagged_pairs)} suspicious answer pair(s) flagged!")

    for pair in flagged_pairs:
        with st.container(border=True):
            col1, col2, col3 = st.columns([2, 2, 1])
            col1.write(f"**Student A:** {pair['student_a']}")
            col2.write(f"**Student B:** {pair['student_b']}")
            col3.metric("Similarity", f"{pair['similarity']}%")
            st.write(f"**Question {pair['question_number']}**")
            c1, c2 = st.columns(2)
            with c1:
                st.caption(f"{pair['student_a']}'s Answer")
                st.info(pair['answer_a'])
            with c2:
                st.caption(f"{pair['student_b']}'s Answer")
                st.info(pair['answer_b'])


# --- Activity Results View (Teacher) ---
def activity_results_view(activity_id):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT title FROM activities WHERE id=?", (activity_id,))
    act = c.fetchone()

    subs = pd.read_sql_query("""
        SELECT s.id, u.name, u.email, s.total_score, s.activity_id
        FROM submissions s
        JOIN users u ON s.student_id = u.id
        WHERE s.activity_id = ?
    """, conn, params=(activity_id,))
    conn.close()

    st.header(f"📊 Results: {act[0] if act else 'Activity'}")

    if st.button("⬅ Back to Dashboard"):
        st.session_state.view_activity_results = None
        st.rerun()

    if subs.empty:
        st.info("No submissions yet for this activity.")
        return

    st.dataframe(subs[['name', 'email', 'total_score']].rename(columns={
        'name': 'Student', 'email': 'Email', 'total_score': 'Total Score'
    }))

    st.subheader("Detailed View per Student")
    for _, row in subs.iterrows():
        if st.button(f"View {row['name']}'s submission", key=f"detail_{row['id']}"):
            st.session_state.view_results = row['id']
            st.rerun()


# --- Student Dashboard ---
def student_dashboard():
    st.header(f"Student Portal: {st.session_state.user['name']}")
    code = st.sidebar.text_input("Join with Code")
    if st.sidebar.button("Join"):
        conn = get_db_connection()
        c = conn.cursor()
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
        with st.spinner("Evaluating your answers using SBERT + Groq AI..."):
            evaluated = []
            total = 0
            for i, q in enumerate(questions):
                score, feed, strn, imp = evaluate_answer(
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
                    "improvements": imp
                })
                total += score

        conn = get_db_connection()
        c = conn.cursor()
        c.execute("INSERT INTO submissions (activity_id, student_id, answers, evaluated_answers, total_score) VALUES (?,?,?,?,?)",
                  (act_id, st.session_state.user['id'], json.dumps(answers), json.dumps(evaluated), total))
        conn.commit()
        conn.close()

        st.success(f"Exam Submitted! Total Score: **{total}**")
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
            with st.spinner("Re-evaluating using SBERT + Groq AI..."):
                questions = json.loads(sub[7])
                answers = json.loads(sub[3])
                evaluated = []
                total = 0
                for i, q in enumerate(questions):
                    score, feed, strn, imp = evaluate_answer(
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
                        "improvements": imp
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
            st.write(f"**Score:** {ans['score']}")
            st.write(f"**AI Feedback:** *\"{ans['feedback']}\"*")
            if ans.get('strengths') and ans['strengths'] != 'N/A':
                st.success(f"✅ **Strengths:** {ans['strengths']}")
            if ans.get('improvements') and ans['improvements'] != 'N/A':
                st.warning(f"💡 **Improvements:** {ans['improvements']}")


# --- Main Logic ---
if st.session_state.user is None:
    auth_page()
else:
    if st.sidebar.button("Logout"):
        st.session_state.user = None
        st.rerun()

    # --- Route to correct view ---
    if 'active_exam' in st.session_state and st.session_state.active_exam:
        exam_interface()

    elif 'plagiarism_activity_id' in st.session_state and st.session_state.plagiarism_activity_id:
        plagiarism_view(st.session_state.plagiarism_activity_id)

    elif 'view_activity_results' in st.session_state and st.session_state.view_activity_results:
        if st.sidebar.button("Back to Dashboard"):
            st.session_state.view_activity_results = None
            st.rerun()
        activity_results_view(st.session_state.view_activity_results)

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

        # Show past submissions (student only)
        if st.session_state.user['role'] == 'student':
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
