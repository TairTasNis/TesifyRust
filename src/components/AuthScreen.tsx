import React, { useState } from 'react';
import { auth, db, googleProvider } from '../services/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup } from 'firebase/auth';
import { ref, set } from 'firebase/database';
import { Music, Mail, Lock, User, Calendar, Loader2 } from 'lucide-react';

export default function AuthScreen() {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    // Registration extras
    const [username, setUsername] = useState('');
    const [fullName, setFullName] = useState('');
    const [dob, setDob] = useState('');

    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            if (isLogin) {
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                if (!username || !fullName || !dob) {
                    throw new Error("Пожалуйста, заполните все поля.");
                }
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                // Save extra details in Firestore
                await set(ref(db, `users/${user.uid}`), {
                    username,
                    fullName,
                    dob,
                    email,
                    createdAt: Date.now()
                });
            }
        } catch (err: any) {
            if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
                setError('Неверная почта или пароль.');
            } else if (err.code === 'auth/email-already-in-use') {
                setError('Пользователь с такой почтой уже существует.');
            } else if (err.code === 'auth/weak-password') {
                setError('Пароль слишком слабый (минимум 6 символов).');
            } else {
                setError(err.message || 'Произошла ошибка при авторизации.');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleLogin = async () => {
        setError('');
        setLoading(true);
        try {
            const cred = await signInWithPopup(auth, googleProvider);
            // Optional: Check if user document exists, if not, create a basic one
            const user = cred.user;
            await set(ref(db, `users/${user.uid}`), {
                username: user.displayName?.split(' ')[0] || 'User',
                fullName: user.displayName || '',
                email: user.email,
                dob: '',
                createdAt: Date.now()
            });
        } catch (err: any) {
            setError(err.message || 'Ошибка входа через Google.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-screen bg-black text-white font-sans overflow-hidden items-center justify-center p-4">
            <div className="w-full max-w-md bg-zinc-900 border border-white/10 rounded-2xl p-8 shadow-2xl animate-in fade-in slide-in-from-bottom-5">

                <div className="flex items-center justify-center gap-3 mb-8">
                    <Music size={36} className="text-green-500" />
                    <h1 className="text-4xl font-bold tracking-tight">Tesify</h1>
                </div>

                <h2 className="text-2xl font-semibold text-center mb-6">
                    {isLogin ? 'Вход в аккаунт' : 'Регистрация'}
                </h2>

                {error && (
                    <div className="bg-red-500/20 border border-red-500/50 text-red-200 p-3 rounded-xl mb-6 text-sm text-center">
                        {error}
                    </div>
                )}

                <form onSubmit={handleAuth} className="space-y-4">
                    {!isLogin && (
                        <>
                            <div className="relative">
                                <User className="absolute left-3 top-3 text-zinc-400" size={20} />
                                <input
                                    type="text"
                                    placeholder="Имя пользователя (Username)"
                                    value={username}
                                    onChange={e => setUsername(e.target.value)}
                                    className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 pl-10 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-all"
                                />
                            </div>
                            <div className="relative">
                                <User className="absolute left-3 top-3 text-zinc-400" size={20} />
                                <input
                                    type="text"
                                    placeholder="Имя и Фамилия"
                                    value={fullName}
                                    onChange={e => setFullName(e.target.value)}
                                    className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 pl-10 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-all"
                                />
                            </div>
                            <div className="relative">
                                <Calendar className="absolute left-3 top-3 text-zinc-400" size={20} />
                                <input
                                    type="date"
                                    value={dob}
                                    onChange={e => setDob(e.target.value)}
                                    className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 pl-10 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-all cursor-text min-h-[48px]"
                                    style={{ colorScheme: 'dark' }}
                                />
                            </div>
                        </>
                    )}

                    <div className="relative">
                        <Mail className="absolute left-3 top-3 text-zinc-400" size={20} />
                        <input
                            type="email"
                            placeholder="Электронная почта"
                            required
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 pl-10 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-all"
                        />
                    </div>

                    <div className="relative">
                        <Lock className="absolute left-3 top-3 text-zinc-400" size={20} />
                        <input
                            type="password"
                            placeholder="Пароль"
                            required
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 pl-10 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-all"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-green-500 hover:bg-green-400 text-black font-bold py-3.5 rounded-xl transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50 flex justify-center items-center"
                    >
                        {loading ? <Loader2 className="animate-spin" size={24} /> : (isLogin ? 'Войти' : 'Зарегистрироваться')}
                    </button>
                </form>

                <div className="my-6 flex items-center gap-4">
                    <div className="h-px bg-white/10 flex-1"></div>
                    <span className="text-zinc-500 text-sm">ИЛИ</span>
                    <div className="h-px bg-white/10 flex-1"></div>
                </div>

                <button
                    onClick={handleGoogleLogin}
                    disabled={loading}
                    className="w-full bg-white hover:bg-gray-200 text-black font-semibold py-3.5 rounded-xl transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50 flex items-center justify-center gap-3 mb-6"
                >
                    <svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
                        <g transform="matrix(1, 0, 0, 1, 27.009001, -39.238998)">
                            <path fill="#4285F4" d="M -3.264 51.509 C -3.264 50.719 -3.334 49.969 -3.454 49.239 L -14.754 49.239 L -14.754 53.749 L -8.284 53.749 C -8.574 55.229 -9.424 56.479 -10.684 57.329 L -10.684 60.329 L -6.824 60.329 C -4.564 58.239 -3.264 55.159 -3.264 51.509 Z" />
                            <path fill="#34A853" d="M -14.754 63.239 C -11.514 63.239 -8.804 62.159 -6.824 60.329 L -10.684 57.329 C -11.764 58.049 -13.134 58.489 -14.754 58.489 C -17.884 58.489 -20.534 56.379 -21.484 53.529 L -25.464 53.529 L -25.464 56.619 C -23.494 60.539 -19.444 63.239 -14.754 63.239 Z" />
                            <path fill="#FBBC05" d="M -21.484 53.529 C -21.734 52.809 -21.864 52.039 -21.864 51.239 C -21.864 50.439 -21.724 49.669 -21.484 48.949 L -21.484 45.859 L -25.464 45.859 C -26.284 47.479 -26.754 49.299 -26.754 51.239 C -26.754 53.179 -26.284 54.999 -25.464 56.619 L -21.484 53.529 Z" />
                            <path fill="#EA4335" d="M -14.754 43.989 C -12.984 43.989 -11.404 44.599 -10.154 45.789 L -6.734 42.369 C -8.804 40.429 -11.514 39.239 -14.754 39.239 C -19.444 39.239 -23.494 41.939 -25.464 45.859 L -21.484 48.949 C -20.534 46.099 -17.884 43.989 -14.754 43.989 Z" />
                        </g>
                    </svg>
                    Войти через Google
                </button>

                <p className="text-center text-zinc-400 text-sm">
                    {isLogin ? "Нет аккаунта? " : "Уже есть аккаунт? "}
                    <button
                        onClick={() => { setIsLogin(!isLogin); setError(''); }}
                        className="text-white hover:text-green-400 font-semibold transition-colors underline underline-offset-4"
                    >
                        {isLogin ? "Создать" : "Войти"}
                    </button>
                </p>
            </div>
        </div>
    );
}
