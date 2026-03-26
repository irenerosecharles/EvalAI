import React, { useState, useEffect } from 'react';
import { 
  BookOpen, 
  Users, 
  Plus, 
  ChevronRight, 
  Clock, 
  FileText, 
  BarChart3, 
  Bell, 
  LogOut, 
  Search,
  CheckCircle2,
  AlertCircle,
  Timer,
  Send,
  Download,
  MoreVertical,
  X,
  Copy,
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { BrowserRouter as Router, Routes, Route, Link, useNavigate, useParams, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { cn } from './lib/utils';
import axios from 'axios';
import { format } from 'date-fns';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';

// --- Components ---

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-[#F8F9FA]">
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mb-6">
            <AlertCircle size={32} />
          </div>
          <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
          <p className="text-[#6B7280] mb-8 max-w-md">
            An unexpected error occurred in the academic portal. Please try refreshing the page or contact support if the problem persists.
          </p>
          <button 
            onClick={() => window.location.reload()}
            className="px-8 py-3 bg-[#1A1A1A] text-white rounded-xl font-bold hover:bg-[#333] transition-all"
          >
            Reload Portal
          </button>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button 
      onClick={handleCopy}
      className={cn(
        "p-1.5 rounded-md transition-all",
        copied ? "bg-green-100 text-green-600" : "hover:bg-gray-200 text-gray-500"
      )}
      title="Copy Code"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
};

const Navbar = () => {
  const { user, logout } = useAuth();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifs, setShowNotifs] = useState(false);

  useEffect(() => {
    if (user) {
      axios.get('/api/notifications', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
        .then(res => setNotifications(res.data))
        .catch(console.error);
    }
  }, [user]);

  return (
    <nav className="h-16 bg-white border-b border-[#E5E7EB] flex items-center justify-between px-8 sticky top-0 z-50">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 bg-[#1A1A1A] rounded-lg flex items-center justify-center">
          <BookOpen className="text-white w-5 h-5" />
        </div>
        <span className="text-xl font-bold tracking-tight">EvalAI</span>
      </div>

      <div className="flex items-center gap-6">
        <div className="relative">
          <button 
            onClick={() => setShowNotifs(!showNotifs)}
            className="p-2 hover:bg-[#F3F4F6] rounded-full relative transition-colors"
          >
            <Bell size={20} className="text-[#6B7280]" />
            {notifications.some(n => !n.read) && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#DC2626] rounded-full border-2 border-white" />
            )}
          </button>
          <AnimatePresence>
            {showNotifs && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute right-0 mt-2 w-80 bg-white border border-[#E5E7EB] rounded-2xl shadow-xl overflow-hidden z-50"
              >
                <div className="p-4 border-b border-[#E5E7EB] flex justify-between items-center">
                  <span className="font-semibold text-sm">Notifications</span>
                  <button className="text-[10px] text-[#6B7280] hover:text-[#1A1A1A]">Mark all as read</button>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {notifications.length > 0 ? notifications.map(n => (
                    <div key={n._id} className="p-4 hover:bg-[#F9FAFB] border-b border-[#E5E7EB] last:border-0">
                      <p className="text-xs text-[#374151]">{n.message}</p>
                      <span className="text-[10px] text-[#9CA3AF] mt-1 block">{format(new Date(n.createdAt), 'MMM d, h:mm a')}</span>
                    </div>
                  )) : (
                    <div className="p-8 text-center text-[#6B7280] text-xs">No notifications</div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="h-4 w-[1px] bg-[#E5E7EB]" />

        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-semibold">{user?.name}</p>
            <p className="text-[10px] text-[#6B7280] uppercase font-bold tracking-wider">{user?.role}</p>
          </div>
          <button 
            onClick={logout}
            className="p-2 hover:bg-[#FEF2F2] hover:text-[#DC2626] rounded-full transition-colors"
          >
            <LogOut size={20} />
          </button>
        </div>
      </div>
    </nav>
  );
};

// --- Pages ---

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await axios.post('/api/auth/login', { email, password });
      login(res.data.token, res.data.user);
      navigate('/');
    } catch (err: any) {
      alert(err.response?.data?.message || 'Academic authentication failed. Please verify your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white p-10 rounded-[2.5rem] border border-[#E5E7EB] shadow-2xl relative overflow-hidden"
      >
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-[#1A1A1A] via-[#4B5563] to-[#1A1A1A]" />
        
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-[#1A1A1A] rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg rotate-3">
            <BookOpen className="text-white w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-[#111827]">Academic Portal</h1>
          <p className="text-[#6B7280] text-sm mt-2 font-medium">Secure access to EvalAI evaluation systems</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-[10px] font-bold text-[#6B7280] uppercase tracking-widest mb-2 ml-1">Institutional Email</label>
            <div className="relative">
              <input 
                type="email" 
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full pl-11 pr-4 py-3.5 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl focus:ring-2 focus:ring-[#1A1A1A] focus:bg-white outline-none transition-all text-sm"
                placeholder="name@university.edu"
                required
              />
              <Users className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA3AF] w-4 h-4" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-[#6B7280] uppercase tracking-widest mb-2 ml-1">Security Key</label>
            <div className="relative">
              <input 
                type="password" 
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full pl-11 pr-4 py-3.5 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl focus:ring-2 focus:ring-[#1A1A1A] focus:bg-white outline-none transition-all text-sm"
                placeholder="••••••••"
                required
              />
              <Clock className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA3AF] w-4 h-4" />
            </div>
          </div>
          
          <button 
            disabled={isLoading}
            className="w-full py-4 bg-[#1A1A1A] text-white rounded-2xl font-bold hover:bg-[#333] transition-all active:scale-[0.98] mt-6 shadow-lg shadow-black/10 disabled:opacity-70 flex items-center justify-center gap-2"
          >
            {isLoading ? 'Authenticating...' : 'Enter Portal'}
            {!isLoading && <ChevronRight size={18} />}
          </button>
        </form>

        <div className="mt-10 pt-8 border-t border-[#F3F4F6] text-center">
          <p className="text-sm text-[#6B7280]">
            New to the platform? <Link to="/register" className="text-[#1A1A1A] font-bold hover:underline decoration-2 underline-offset-4">Create Credentials</Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
};

const Register = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'teacher' | 'student'>('student');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await axios.post('/api/auth/register', { name, email, password, role });
      alert('Academic credentials established successfully. Proceeding to login.');
      navigate('/login');
    } catch (err: any) {
      alert(err.response?.data?.message || 'Registration failed. Please ensure all fields are valid.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white p-10 rounded-[2.5rem] border border-[#E5E7EB] shadow-2xl relative overflow-hidden"
      >
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-[#1A1A1A] via-[#4B5563] to-[#1A1A1A]" />
        
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold tracking-tight text-[#111827]">Establish Credentials</h1>
          <p className="text-[#6B7280] text-sm mt-2 font-medium">Join the EvalAI academic network</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="flex p-1.5 bg-[#F3F4F6] rounded-2xl mb-6">
            <button 
              type="button"
              onClick={() => setRole('student')}
              className={cn(
                "flex-1 py-2.5 text-[10px] font-black rounded-xl transition-all tracking-widest", 
                role === 'student' ? "bg-white shadow-md text-[#1A1A1A]" : "text-[#9CA3AF]"
              )}
            >
              STUDENT
            </button>
            <button 
              type="button"
              onClick={() => setRole('teacher')}
              className={cn(
                "flex-1 py-2.5 text-[10px] font-black rounded-xl transition-all tracking-widest", 
                role === 'teacher' ? "bg-white shadow-md text-[#1A1A1A]" : "text-[#9CA3AF]"
              )}
            >
              TEACHER
            </button>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-[#6B7280] uppercase tracking-widest mb-2 ml-1">Legal Name</label>
            <input 
              type="text" 
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-4 py-3.5 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl focus:ring-2 focus:ring-[#1A1A1A] focus:bg-white outline-none transition-all text-sm"
              placeholder="John Doe"
              required
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-[#6B7280] uppercase tracking-widest mb-2 ml-1">Institutional Email</label>
            <input 
              type="email" 
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-4 py-3.5 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl focus:ring-2 focus:ring-[#1A1A1A] focus:bg-white outline-none transition-all text-sm"
              placeholder="name@university.edu"
              required
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-[#6B7280] uppercase tracking-widest mb-2 ml-1">Security Key</label>
            <input 
              type="password" 
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-4 py-3.5 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl focus:ring-2 focus:ring-[#1A1A1A] focus:bg-white outline-none transition-all text-sm"
              placeholder="••••••••"
              required
            />
          </div>
          
          <button 
            disabled={isLoading}
            className="w-full py-4 bg-[#1A1A1A] text-white rounded-2xl font-bold hover:bg-[#333] transition-all active:scale-[0.98] mt-6 shadow-lg shadow-black/10 disabled:opacity-70"
          >
            {isLoading ? 'Processing...' : 'Establish Credentials'}
          </button>
        </form>

        <div className="mt-10 pt-8 border-t border-[#F3F4F6] text-center">
          <p className="text-sm text-[#6B7280]">
            Already registered? <Link to="/login" className="text-[#1A1A1A] font-bold hover:underline decoration-2 underline-offset-4">Access Portal</Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
};

const TeacherDashboard = () => {
  const [classrooms, setClassrooms] = useState<any[]>([]);
  const [showCreateClass, setShowCreateClass] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const { token } = useAuth();

  useEffect(() => {
    fetchClassrooms();
  }, []);

  const fetchClassrooms = async () => {
    try {
      const res = await axios.get('/api/classrooms', { headers: { Authorization: `Bearer ${token}` } });
      setClassrooms(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Failed to fetch classrooms:", err);
      setClassrooms([]);
    }
  };

  const createClassroom = async () => {
    if (!newClassName) return;
    await axios.post('/api/classrooms', { name: newClassName }, { headers: { Authorization: `Bearer ${token}` } });
    setNewClassName('');
    setShowCreateClass(false);
    fetchClassrooms();
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-10">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Teacher Dashboard</h1>
          <p className="text-[#6B7280] mt-1">Manage your classrooms and academic activities</p>
        </div>
        <button 
          onClick={() => setShowCreateClass(true)}
          className="flex items-center gap-2 px-6 py-3 bg-[#1A1A1A] text-white rounded-2xl font-semibold hover:bg-[#333] transition-all"
        >
          <Plus size={20} /> Create Classroom
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {classrooms.map(cls => (
          <Link 
            key={cls._id} 
            to={`/classroom/${cls._id}`}
            className="group bg-white p-6 rounded-3xl border border-[#E5E7EB] hover:border-[#1A1A1A] hover:shadow-xl transition-all"
          >
            <div className="w-12 h-12 bg-[#F3F4F6] rounded-2xl flex items-center justify-center mb-4 group-hover:bg-[#1A1A1A] transition-colors">
              <Users className="text-[#6B7280] group-hover:text-white transition-colors" />
            </div>
            <h3 className="text-xl font-bold mb-1">{cls.name}</h3>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-[#6B7280]">Created {format(new Date(cls.createdAt), 'MMM d, yyyy')}</p>
              <div className="flex items-center gap-1.5 px-2 py-1 bg-[#F3F4F6] rounded text-[10px] font-mono font-bold text-[#1A1A1A] border border-[#E5E7EB]">
                CODE: {cls.joinCode}
                <CopyButton text={cls.joinCode} />
              </div>
            </div>
            <div className="flex items-center text-sm font-semibold text-[#1A1A1A]">
              View Activities <ChevronRight size={16} className="ml-1 group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>
        ))}
      </div>

      <AnimatePresence>
        {showCreateClass && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[100]">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white p-8 rounded-3xl w-full max-w-md shadow-2xl"
            >
              <h3 className="text-xl font-bold mb-6">New Classroom</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#6B7280] uppercase mb-1.5 ml-1">Classroom Name</label>
                  <input 
                    type="text" 
                    value={newClassName}
                    onChange={e => setNewClassName(e.target.value)}
                    className="w-full px-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl focus:ring-2 focus:ring-[#1A1A1A] outline-none"
                    placeholder="e.g. Class 10 - Computer Science"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button 
                    onClick={() => setShowCreateClass(false)}
                    className="flex-1 py-3 bg-[#F3F4F6] text-[#6B7280] rounded-xl font-semibold hover:bg-[#E5E7EB]"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={createClassroom}
                    className="flex-1 py-3 bg-[#1A1A1A] text-white rounded-xl font-semibold hover:bg-[#333]"
                  >
                    Create
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const ClassroomDetail = () => {
  const { id } = useParams();
  const [classroom, setClassroom] = useState<any>(null);
  const [activities, setActivities] = useState<any[]>([]);
  const [showCreateActivity, setShowCreateActivity] = useState(false);
  const [newActivity, setNewActivity] = useState({ title: '', type: 'exam', duration: 60, deadline: '' });
  const [questions, setQuestions] = useState([{ text: '', maxMarks: 10, referenceAnswer: '' }]);
  const { token } = useAuth();

  useEffect(() => {
    fetchClassroom();
    fetchActivities();
  }, [id]);

  const fetchClassroom = async () => {
    const res = await axios.get(`/api/classrooms/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    setClassroom(res.data);
  };

  const fetchActivities = async () => {
    const res = await axios.get(`/api/activities/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    setActivities(res.data);
  };

  const createActivity = async () => {
    await axios.post('/api/activities', { 
      ...newActivity, 
      classroom: id, 
      questions 
    }, { headers: { Authorization: `Bearer ${token}` } });
    setShowCreateActivity(false);
    fetchActivities();
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-10">
        <div>
          <Link to="/" className="text-sm text-[#6B7280] hover:text-[#1A1A1A] flex items-center gap-1 mb-2">
            <ChevronRight size={14} className="rotate-180" /> Back to Dashboard
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{classroom?.name || 'Loading...'}</h1>
            {classroom && (
              <div className="flex items-center gap-2 px-3 py-1 bg-[#1A1A1A] text-white rounded-full text-xs font-mono font-bold tracking-wider">
                JOIN CODE: {classroom.joinCode}
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(classroom.joinCode);
                    alert('Join code copied to clipboard!');
                  }}
                  className="hover:text-gray-300 transition-colors"
                >
                  <Copy size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
        <button 
          onClick={() => setShowCreateActivity(true)}
          className="flex items-center gap-2 px-6 py-3 bg-[#1A1A1A] text-white rounded-2xl font-semibold hover:bg-[#333] transition-all"
        >
          <Plus size={20} /> New Activity
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {activities.map(act => (
          <div key={act._id} className="bg-white p-6 rounded-3xl border border-[#E5E7EB] shadow-sm">
            <div className="flex justify-between items-start mb-4">
              <div className={cn(
                "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                act.type === 'exam' ? "bg-[#FEF2F2] text-[#DC2626]" : "bg-[#F0FDF4] text-[#16A34A]"
              )}>
                {act.type}
              </div>
              <div className="flex items-center gap-2 text-xs font-mono bg-[#F9FAFB] px-2 py-1 rounded border border-[#E5E7EB]">
                CODE: <span className="font-bold text-[#1A1A1A]">{act.joinCode}</span>
                <CopyButton text={act.joinCode} />
              </div>
            </div>
            <h3 className="text-xl font-bold mb-2">{act.title}</h3>
            <div className="flex items-center gap-4 text-sm text-[#6B7280] mb-6">
              <div className="flex items-center gap-1">
                <FileText size={16} /> {act.questions.length} Questions
              </div>
              <div className="flex items-center gap-1">
                <Clock size={16} /> {act.type === 'assignment' ? format(new Date(act.deadline), 'MMM d') : `${act.duration}m`}
              </div>
            </div>
            <Link 
              to={`/activity/${act._id}/results`}
              className="w-full flex items-center justify-center gap-2 py-3 bg-[#F3F4F6] text-[#1A1A1A] rounded-xl font-semibold hover:bg-[#E5E7EB] transition-all"
            >
              <BarChart3 size={18} /> View Results
            </Link>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {showCreateActivity && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[100] overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="bg-white p-8 rounded-3xl w-full max-w-2xl shadow-2xl my-8"
            >
              <div className="flex justify-between items-center mb-8">
                <h3 className="text-2xl font-bold">Create Activity</h3>
                <button onClick={() => setShowCreateActivity(false)} className="p-2 hover:bg-[#F3F4F6] rounded-full">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#6B7280] uppercase mb-1.5 ml-1">Title</label>
                    <input 
                      type="text" 
                      value={newActivity.title}
                      onChange={e => setNewActivity({...newActivity, title: e.target.value})}
                      className="w-full px-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl outline-none"
                      placeholder="e.g. Mid-term Exam"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#6B7280] uppercase mb-1.5 ml-1">Type</label>
                    <select 
                      value={newActivity.type}
                      onChange={e => setNewActivity({...newActivity, type: e.target.value as any})}
                      className="w-full px-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl outline-none"
                    >
                      <option value="exam">Exam</option>
                      <option value="assignment">Assignment</option>
                    </select>
                  </div>
                </div>

                {newActivity.type === 'assignment' ? (
                  <div>
                    <label className="block text-xs font-semibold text-[#6B7280] uppercase mb-1.5 ml-1">Deadline</label>
                    <input 
                      type="datetime-local" 
                      value={newActivity.deadline}
                      onChange={e => setNewActivity({...newActivity, deadline: e.target.value})}
                      className="w-full px-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl outline-none"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-semibold text-[#6B7280] uppercase mb-1.5 ml-1">Duration (Minutes)</label>
                    <input 
                      type="number" 
                      value={newActivity.duration}
                      onChange={e => setNewActivity({...newActivity, duration: parseInt(e.target.value)})}
                      className="w-full px-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl outline-none"
                    />
                  </div>
                )}

                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h4 className="font-bold text-sm uppercase tracking-wider text-[#6B7280]">Questions</h4>
                    <button 
                      onClick={() => setQuestions([...questions, { text: '', maxMarks: 10, referenceAnswer: '' }])}
                      className="text-xs font-bold text-[#1A1A1A] flex items-center gap-1 hover:underline"
                    >
                      <Plus size={14} /> Add Question
                    </button>
                  </div>
                  {questions.map((q, idx) => (
                    <div key={idx} className="p-4 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl space-y-3">
                      <div className="flex gap-4">
                        <div className="flex-1">
                          <label className="block text-[10px] font-bold text-[#9CA3AF] uppercase mb-1">Question Text</label>
                          <input 
                            type="text" 
                            value={q.text}
                            onChange={e => {
                              const nq = [...questions];
                              nq[idx].text = e.target.value;
                              setQuestions(nq);
                            }}
                            className="w-full px-3 py-2 bg-white border border-[#E5E7EB] rounded-lg outline-none text-sm"
                            placeholder="Enter question..."
                          />
                        </div>
                        <div className="w-24">
                          <label className="block text-[10px] font-bold text-[#9CA3AF] uppercase mb-1">Marks</label>
                          <input 
                            type="number" 
                            value={q.maxMarks}
                            onChange={e => {
                              const nq = [...questions];
                              nq[idx].maxMarks = parseInt(e.target.value);
                              setQuestions(nq);
                            }}
                            className="w-full px-3 py-2 bg-white border border-[#E5E7EB] rounded-lg outline-none text-sm"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-[#9CA3AF] uppercase mb-1">Reference Answer (Optional)</label>
                        <textarea 
                          value={q.referenceAnswer}
                          onChange={e => {
                            const nq = [...questions];
                            nq[idx].referenceAnswer = e.target.value;
                            setQuestions(nq);
                          }}
                          className="w-full px-3 py-2 bg-white border border-[#E5E7EB] rounded-lg outline-none text-sm h-20 resize-none"
                          placeholder="Model answer for AI evaluation..."
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    onClick={() => setShowCreateActivity(false)}
                    className="flex-1 py-3 bg-[#F3F4F6] text-[#6B7280] rounded-xl font-semibold hover:bg-[#E5E7EB]"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={createActivity}
                    className="flex-1 py-3 bg-[#1A1A1A] text-white rounded-xl font-semibold hover:bg-[#333]"
                  >
                    Launch Activity
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const StudentDashboard = () => {
  const [classrooms, setClassrooms] = useState<any[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const { token } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    fetchClassrooms();
  }, []);

  const fetchClassrooms = async () => {
    try {
      const res = await axios.get('/api/classrooms', { headers: { Authorization: `Bearer ${token}` } });
      setClassrooms(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Failed to fetch classrooms:", err);
      setClassrooms([]);
    }
  };

  const joinActivity = async () => {
    if (!joinCode) return;
    setIsJoining(true);
    try {
      const res = await axios.post('/api/activities/join', { code: joinCode }, { headers: { Authorization: `Bearer ${token}` } });
      setJoinCode('');
      fetchClassrooms();
      if (res.data.type === 'activity') {
        alert(`Successfully joined activity: ${res.data.title}`);
      } else {
        alert(`Successfully joined classroom: ${res.data.title}`);
      }
    } catch (err) {
      alert('Invalid join code');
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        <div className="lg:col-span-2 space-y-10">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Student Dashboard</h1>
            <p className="text-[#6B7280] mt-1">Access your courses and academic evaluations</p>
          </div>

          <div className="space-y-6">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <BookOpen size={20} /> My Classrooms
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {classrooms.map(cls => (
                <Link 
                  key={cls._id} 
                  to={`/student/classroom/${cls._id}`}
                  className="group bg-white p-6 rounded-3xl border border-[#E5E7EB] hover:border-[#1A1A1A] hover:shadow-xl transition-all"
                >
                  <div className="w-10 h-10 bg-[#F3F4F6] rounded-xl flex items-center justify-center mb-4 group-hover:bg-[#1A1A1A] transition-colors">
                    <Users size={18} className="text-[#6B7280] group-hover:text-white" />
                  </div>
                  <h3 className="text-lg font-bold mb-1">{cls.name}</h3>
                  <p className="text-xs text-[#6B7280]">Teacher: {cls.teacher.name}</p>
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-[#1A1A1A] p-8 rounded-[2rem] text-white shadow-2xl">
            <h3 className="text-xl font-bold mb-2">Join Activity</h3>
            <p className="text-white/60 text-sm mb-6">Enter the code provided by your teacher to access an exam or assignment.</p>
            <div className="space-y-4">
              <input 
                type="text" 
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase())}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl outline-none focus:ring-2 focus:ring-white/50 text-white placeholder-white/30 font-mono text-center tracking-widest"
                placeholder="EX-XXXXX"
              />
              <button 
                onClick={joinActivity}
                disabled={isJoining}
                className="w-full py-3 bg-white text-[#1A1A1A] rounded-xl font-bold hover:bg-white/90 transition-all active:scale-95 disabled:opacity-50"
              >
                {isJoining ? 'Joining...' : 'Join Now'}
              </button>
            </div>
          </div>

          <div className="bg-white p-6 rounded-3xl border border-[#E5E7EB]">
            <h4 className="font-bold text-sm mb-4 uppercase tracking-wider text-[#6B7280]">Academic Status</h4>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-[#6B7280]">Enrolled Classes</span>
                <span className="text-sm font-bold">{classrooms.length}</span>
              </div>
              <div className="p-4 bg-[#F9FAFB] rounded-2xl border border-[#E5E7EB] text-[10px] text-[#6B7280] leading-relaxed italic">
                Join activities using codes provided by your teacher to begin evaluations.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const StudentClassroomDetail = () => {
  const { id } = useParams();
  const [activities, setActivities] = useState<any[]>([]);
  const { token } = useAuth();

  useEffect(() => {
    axios.get(`/api/activities/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => setActivities(res.data))
      .catch(console.error);
  }, [id]);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-10">
        <Link to="/" className="text-sm text-[#6B7280] hover:text-[#1A1A1A] flex items-center gap-1 mb-2">
          <ChevronRight size={14} className="rotate-180" /> Back to Dashboard
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Available Activities</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {activities.map(act => (
          <div key={act._id} className="bg-white p-6 rounded-3xl border border-[#E5E7EB] shadow-sm flex flex-col">
            <div className="flex justify-between items-start mb-4">
              <div className={cn(
                "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                act.type === 'exam' ? "bg-[#FEF2F2] text-[#DC2626]" : "bg-[#F0FDF4] text-[#16A34A]"
              )}>
                {act.type}
              </div>
            </div>
            <h3 className="text-xl font-bold mb-2">{act.title}</h3>
            <div className="flex items-center gap-4 text-sm text-[#6B7280] mb-8">
              <div className="flex items-center gap-1">
                <FileText size={16} /> {act.questions.length} Questions
              </div>
              <div className="flex items-center gap-1">
                <Clock size={16} /> {act.type === 'assignment' ? format(new Date(act.deadline), 'MMM d') : `${act.duration}m`}
              </div>
            </div>
            <div className="mt-auto flex gap-3">
              <Link 
                to={`/activity/${act._id}/take`}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#1A1A1A] text-white rounded-xl font-semibold hover:bg-[#333] transition-all"
              >
                <Send size={18} /> Start Activity
              </Link>
              <Link 
                to={`/activity/${act._id}/results`}
                className="px-4 flex items-center justify-center bg-[#F3F4F6] text-[#1A1A1A] rounded-xl hover:bg-[#E5E7EB] transition-all"
              >
                <BarChart3 size={18} />
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const ExamInterface = () => {
  const { id } = useParams();
  const [activity, setActivity] = useState<any>(null);
  const [answers, setAnswers] = useState<any[]>([]);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const { token } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    fetchActivity();
  }, [id]);

  const fetchActivity = async () => {
    try {
      const res = await axios.get(`/api/activities/detail/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      setActivity(res.data);
      if (res.data.duration) {
        setTimeLeft(res.data.duration * 60);
      } else {
        setTimeLeft(3600); // Default 1 hour if no duration
      }
    } catch (err) {
      alert('Failed to load activity');
      navigate('/');
    }
  };

  useEffect(() => {
    if (timeLeft > 0) {
      const timer = setInterval(() => setTimeLeft(prev => prev - 1), 1000);
      return () => clearInterval(timer);
    } else if (timeLeft === 0 && activity) {
      submitExam();
    }
  }, [timeLeft, activity]);

  useEffect(() => {
    if (isSuccess) {
      const timer = setTimeout(() => navigate('/'), 3000);
      return () => clearTimeout(timer);
    }
  }, [isSuccess, navigate]);

  const submitExam = async () => {
    if (isSubmitting || isSuccess) return;
    setIsSubmitting(true);
    try {
      await axios.post('/api/submissions', { 
        activityId: id, 
        answers: activity.questions.map((q: any, idx: number) => {
          const qId = q._id || idx.toString();
          return {
            questionId: qId,
            answerText: answers.find(a => a.questionId === qId)?.text || ''
          };
        })
      }, { headers: { Authorization: `Bearer ${token}` } });
      setIsSuccess(true);
    } catch (err) {
      alert('Submission failed. Please try again.');
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-10 text-center">
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-24 h-24 bg-[#16A34A] rounded-[2rem] flex items-center justify-center mb-8 shadow-2xl shadow-green-200"
        >
          <CheckCircle2 className="text-white w-12 h-12" />
        </motion.div>
        <h2 className="text-3xl font-bold mb-4 tracking-tight">Submission Successful</h2>
        <p className="text-[#6B7280] max-w-md mx-auto leading-relaxed mb-8">
          Your answers have been evaluated and recorded. You are being redirected to the dashboard.
        </p>
        <button 
          onClick={() => navigate('/')}
          className="px-8 py-3 bg-[#1A1A1A] text-white rounded-2xl font-bold hover:bg-[#333] transition-all active:scale-95"
        >
          Return to Dashboard Now
        </button>
      </div>
    );
  }

  if (isSubmitting) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-10 text-center">
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-24 h-24 bg-[#1A1A1A] rounded-[2rem] flex items-center justify-center mb-8 shadow-2xl"
        >
          <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
        </motion.div>
        <h2 className="text-3xl font-bold mb-4 tracking-tight">AI Evaluation in Progress</h2>
        <p className="text-[#6B7280] max-w-md mx-auto leading-relaxed">
          Our AI is currently analyzing your responses for semantic accuracy, grammar, and technical depth. This process ensures fair and detailed feedback.
        </p>
        <div className="mt-12 flex gap-3">
          <div className="w-2.5 h-2.5 bg-[#1A1A1A] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2.5 h-2.5 bg-[#1A1A1A] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-2.5 h-2.5 bg-[#1A1A1A] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    );
  }

  if (!activity) return null;

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col">
      <header className="h-20 bg-white border-b border-[#E5E7EB] flex items-center justify-between px-10 sticky top-0 z-50">
        <div>
          <h2 className="text-xl font-bold">{activity.title}</h2>
          <p className="text-xs text-[#6B7280] uppercase font-bold tracking-widest">{activity.type}</p>
        </div>
        <div className="flex items-center gap-6">
          <div className={cn(
            "flex items-center gap-2 px-6 py-2.5 rounded-2xl font-mono font-bold text-lg",
            timeLeft < 300 ? "bg-[#FEF2F2] text-[#DC2626] animate-pulse" : "bg-[#F3F4F6] text-[#1A1A1A]"
          )}>
            <Timer size={20} />
            {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
          </div>
          <button 
            onClick={submitExam}
            disabled={isSubmitting}
            className="px-8 py-3 bg-[#1A1A1A] text-white rounded-2xl font-bold hover:bg-[#333] transition-all active:scale-95"
          >
            {isSubmitting ? 'Submitting...' : 'Finish & Submit'}
          </button>
        </div>
      </header>

      <main className="flex-1 p-10 max-w-4xl mx-auto w-full space-y-10">
        {activity.questions.map((q: any, idx: number) => {
          const qId = q._id || idx.toString();
          return (
            <div key={qId} className="bg-white p-8 rounded-[2rem] border border-[#E5E7EB] shadow-sm">
              <div className="flex justify-between items-start mb-6">
                <span className="text-xs font-bold text-[#9CA3AF] uppercase tracking-widest">Question {idx + 1}</span>
                <span className="text-xs font-bold bg-[#F3F4F6] px-3 py-1 rounded-full">{q.maxMarks} Marks</span>
              </div>
              <h3 className="text-xl font-bold mb-6 leading-relaxed">{q.text}</h3>
              <textarea 
                className="w-full h-64 p-6 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl outline-none focus:ring-2 focus:ring-[#1A1A1A] transition-all resize-none text-lg leading-relaxed"
                placeholder="Type your answer here..."
                onChange={e => {
                  const newAnswers = [...answers];
                  const existing = newAnswers.find(a => a.questionId === qId);
                  if (existing) existing.text = e.target.value;
                  else newAnswers.push({ questionId: qId, text: e.target.value });
                  setAnswers(newAnswers);
                }}
              />
            </div>
          );
        })}
      </main>
    </div>
  );
};

const ResultsView = () => {
  const { id } = useParams();
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [selectedSubmission, setSelectedSubmission] = useState<any>(null);
  const { user, token } = useAuth();

  useEffect(() => {
    axios.get(`/api/submissions/activity/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => {
        setSubmissions(res.data);
        if (user?.role === 'student' && res.data.length > 0) {
          setSelectedSubmission(res.data[0]);
        }
      })
      .catch(console.error);
  }, [id, user]);

  if (submissions.length === 0) return (
    <div className="p-20 text-center text-[#6B7280]">
      <AlertCircle size={48} className="mx-auto mb-4 opacity-20" />
      <p>No results available yet. Evaluation might be in progress.</p>
    </div>
  );

  if (user?.role === 'teacher' && !selectedSubmission) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Activity Submissions</h1>
            <p className="text-[#6B7280] mt-1">Review student performance and marks</p>
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-[#E5E7EB] overflow-hidden shadow-sm">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
                <th className="px-6 py-4 text-xs font-bold text-[#6B7280] uppercase tracking-widest">Student</th>
                <th className="px-6 py-4 text-xs font-bold text-[#6B7280] uppercase tracking-widest">Email</th>
                <th className="px-6 py-4 text-xs font-bold text-[#6B7280] uppercase tracking-widest">Score</th>
                <th className="px-6 py-4 text-xs font-bold text-[#6B7280] uppercase tracking-widest">Submitted At</th>
                <th className="px-6 py-4 text-xs font-bold text-[#6B7280] uppercase tracking-widest text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((s: any) => (
                <tr key={s._id} className="border-b border-[#E5E7EB] hover:bg-[#F9FAFB] transition-colors">
                  <td className="px-6 py-4 font-bold">{s.student.name}</td>
                  <td className="px-6 py-4 text-[#6B7280]">{s.student.email}</td>
                  <td className="px-6 py-4">
                    <span className="px-3 py-1 bg-[#F3F4F6] rounded-full font-bold text-[#1A1A1A]">
                      {s.totalScore}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-[#6B7280]">
                    {format(new Date(s.submittedAt), 'MMM d, h:mm a')}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button 
                      onClick={() => setSelectedSubmission(s)}
                      className="text-sm font-bold text-[#1A1A1A] hover:underline"
                    >
                      View Report
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const submission = selectedSubmission;
  const evaluatedCount = submission.evaluatedAnswers?.length || 0;
  const avgSemantic = evaluatedCount > 0 
    ? (submission.evaluatedAnswers.reduce((acc: number, curr: any) => acc + (curr.semanticScore || 0), 0) / evaluatedCount * 100).toFixed(0)
    : "0";
  const avgGrammar = evaluatedCount > 0 
    ? (submission.evaluatedAnswers.reduce((acc: number, curr: any) => acc + (curr.grammarScore || 0), 0) / evaluatedCount * 100).toFixed(0)
    : "0";
  const maxPossibleMarks = submission.evaluatedAnswers?.reduce((acc: number, curr: any) => acc + (curr.maxMarks || 10), 0) || 0;

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-10">
      <div className="flex justify-between items-end">
        <div>
          {user?.role === 'teacher' && (
            <button 
              onClick={() => setSelectedSubmission(null)}
              className="text-sm text-[#6B7280] hover:text-[#1A1A1A] flex items-center gap-1 mb-2"
            >
              <ChevronRight size={14} className="rotate-180" /> Back to List
            </button>
          )}
          <h1 className="text-3xl font-bold tracking-tight">Evaluation Report</h1>
          <p className="text-[#6B7280] mt-1">
            {user?.role === 'teacher' ? `Reviewing ${submission.student.name}'s performance` : 'Detailed breakdown of your performance'}
          </p>
        </div>
        <div className="text-right">
          <div className="text-5xl font-black tracking-tighter text-[#1A1A1A]">
            {submission.totalScore}<span className="text-2xl text-[#9CA3AF] font-medium">/{maxPossibleMarks}</span>
          </div>
          <p className="text-xs font-bold text-[#6B7280] uppercase tracking-widest mt-1">Total Score</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-[#E5E7EB] flex flex-col items-center text-center">
          <div className="w-12 h-12 bg-[#F0FDF4] text-[#16A34A] rounded-2xl flex items-center justify-center mb-4">
            <CheckCircle2 size={24} />
          </div>
          <h4 className="text-sm font-bold text-[#6B7280] uppercase mb-1">Semantic Match</h4>
          <p className="text-2xl font-bold">{avgSemantic}%</p>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-[#E5E7EB] flex flex-col items-center text-center">
          <div className="w-12 h-12 bg-[#EFF6FF] text-[#2563EB] rounded-2xl flex items-center justify-center mb-4">
            <FileText size={24} />
          </div>
          <h4 className="text-sm font-bold text-[#6B7280] uppercase mb-1">Grammar Score</h4>
          <p className="text-2xl font-bold">{avgGrammar}%</p>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-[#E5E7EB] flex flex-col items-center text-center">
          <div className="w-12 h-12 bg-[#FEF2F2] text-[#DC2626] rounded-2xl flex items-center justify-center mb-4">
            <BarChart3 size={24} />
          </div>
          <h4 className="text-sm font-bold text-[#6B7280] uppercase mb-1">Status</h4>
          <p className="text-2xl font-bold capitalize">{submission.status}</p>
        </div>
      </div>

      <div className="space-y-8">
        <h2 className="text-xl font-bold">Question Breakdown</h2>
        {(submission.evaluatedAnswers || []).map((ans: any, idx: number) => (
          <div key={idx} className="bg-white p-8 rounded-[2rem] border border-[#E5E7EB] shadow-sm space-y-6">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-[#9CA3AF] uppercase tracking-widest">Question {idx + 1}</span>
              <span className="text-lg font-bold">{ans.score} / {ans.maxMarks || 10}</span>
            </div>
            
            <div className="space-y-4">
              <h4 className="text-xs font-bold text-[#6B7280] uppercase">Your Answer</h4>
              <p className="text-[#374151] leading-relaxed bg-[#F9FAFB] p-6 rounded-2xl border border-[#E5E7EB]">
                {ans.answerText}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-6 bg-[#F0FDF4] rounded-2xl border border-[#DCFCE7]">
                <h4 className="text-xs font-bold text-[#16A34A] uppercase mb-2">Strengths</h4>
                <p className="text-sm text-[#166534]">{ans.strengths}</p>
              </div>
              <div className="p-6 bg-[#FEF2F2] rounded-2xl border border-[#FEE2E2]">
                <h4 className="text-xs font-bold text-[#DC2626] uppercase mb-2">Improvements</h4>
                <p className="text-sm text-[#991B1B]">{ans.improvements}</p>
              </div>
            </div>

            <div className="p-6 bg-[#F9FAFB] rounded-2xl border border-[#E5E7EB]">
              <h4 className="text-xs font-bold text-[#6B7280] uppercase mb-2">AI Feedback</h4>
              <p className="text-sm text-[#374151] italic leading-relaxed">"{ans.feedback}"</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// --- Main App ---

const AppContent = () => {
  const { user, isLoading } = useAuth();

  if (isLoading) return null;

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans">
      {user && <Navbar />}
      <Routes>
        <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />
        <Route path="/register" element={!user ? <Register /> : <Navigate to="/" />} />
        
        <Route path="/" element={
          user ? (
            user.role === 'teacher' ? <TeacherDashboard /> : <StudentDashboard />
          ) : <Login />
        } />

        <Route path="/classroom/:id" element={user?.role === 'teacher' ? <ClassroomDetail /> : <Navigate to="/" />} />
        <Route path="/student/classroom/:id" element={user?.role === 'student' ? <StudentClassroomDetail /> : <Navigate to="/" />} />
        <Route path="/activity/:id/take" element={user?.role === 'student' ? <ExamInterface /> : <Navigate to="/" />} />
        <Route path="/activity/:id/results" element={user ? <ResultsView /> : <Login />} />
      </Routes>
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Router>
          <AppContent />
        </Router>
      </AuthProvider>
    </ErrorBoundary>
  );
}
