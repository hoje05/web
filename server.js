// 1. 필요한 프로그램들 (crypto 추가)
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const crypto = require('crypto'); // (새로 추가) 암호화 토큰 생성

// 2. 서버 설정
const app = express();
const port = 3000;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 3. 세션 설정
app.use(session({
    store: new SQLiteStore({ db: 'sessions.db' }),
    secret: 'your-very-secret-key', // 비밀키
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1일
}));

// 4. 데이터베이스(DB) 연결
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error('DB 연결 오류:', err.message);
    } else {
        console.log('데이터베이스에 성공적으로 연결되었습니다.');
        // (수정) 'users' 테이블에 비밀번호 재설정(reset) 컬럼 2개 추가
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            email TEXT UNIQUE, 
            password_hash TEXT,
            role TEXT DEFAULT 'user',
            reset_token TEXT,
            reset_token_expires INTEGER
        )`);
        // (참고) email에도 UNIQUE를 추가해서 중복 가입을 방지합니다.
    }
});

// 5. 프론트엔드 파일들 제공하기
app.use(express.static('.'));

// --- 기존 API (로그인, 회원가입 등) ---
// (이전과 동일... /signup, /login, /logout, /check-session)

app.post('/signup', async (req, res) => {
    const { username, email, password } = req.body;

    let userRole = 'user';
    const count = await new Promise((resolve, reject) => {
        db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
            if (err) reject(err);
            resolve(row.count);
        });
    });

    if (count === 0) {
        userRole = 'admin';
        console.log(`첫 사용자(${username})가 관리자(admin)로 등록됩니다.`);
    }

    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    const sql = `INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)`;
    db.run(sql, [username, email, password_hash, userRole], function (err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ success: false, error: '이미 사용 중인 아이디 또는 이메일입니다.' });
            }
            return res.status(500).json({ success: false, error: err.message });
        }
        res.json({ success: true });
    });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const sql = `SELECT * FROM users WHERE username = ?`;
    db.get(sql, [username], async (err, row) => {
        if (err || !row) {
            return res.status(400).json({ success: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
        }
        const match = await bcrypt.compare(password, row.password_hash);
        if (match) {
            req.session.user = { id: row.id, username: row.username, role: row.role };
            res.json({ success: true, role: row.role });
        } else {
            return res.status(400).json({ success: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
        }
    });
});

app.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ success: false, error: '로그아웃 실패' });
        }
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

app.get('/check-session', (req, res) => {
    if (req.session.user) {
        res.json({ loggedIn: true, user: req.session.user });
    } else {
        res.json({ loggedIn: false });
    }
});

// --- 관리자 전용 API ---
const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ success: false, error: '권한이 없습니다.' });
    }
};
app.get('/api/users', isAdmin, (req, res) => {
    const sql = "SELECT id, username, email, role FROM users";
    db.all(sql, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
        res.json({ success: true, users: rows });
    });
});
app.delete('/api/users/:id', isAdmin, (req, res) => {
    const id = req.params.id;
    if (req.session.user.id == id) {
        return res.status(400).json({ success: false, error: '자기 자신을 삭제할 수 없습니다.' });
    }
    const sql = "DELETE FROM users WHERE id = ?";
    db.run(sql, [id], function (err) {
        if (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
        res.json({ success: true });
    });
});


// --- (새로 추가) 비밀번호 찾기 API ---

// 1. 비밀번호 재설정 요청 (토큰 생성 및 '이메일' 시뮬레이션)
app.post('/forgot-password', (req, res) => {
    const { email } = req.body;
    
    // 1-1. DB에서 이메일로 사용자 찾기
    const sql = `SELECT * FROM users WHERE email = ?`;
    db.get(sql, [email], (err, row) => {
        if (err || !row) {
            // 일부러 성공한 것처럼 응답 (보안 - 이메일 존재 여부를 알려주지 않기 위함)
            return res.json({ success: true, message: '재설정 링크가 전송되었습니다 (콘솔을 확인하세요).' });
        }

        // 1-2. 임시 토큰 생성 (32바이트 랜덤 문자열)
        const token = crypto.randomBytes(32).toString('hex');
        // 1-3. 토큰 만료 시간 설정 (지금으로부터 1시간 뒤)
        const expires = Date.now() + 1000 * 60 * 60; // 1시간 (밀리초 단위)

        // 1-4. DB에 토큰과 만료 시간 저장
        const updateSql = `UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE email = ?`;
        db.run(updateSql, [token, expires, email], (err) => {
            if (err) {
                return res.status(500).json({ success: false, error: '토큰 저장 중 오류' });
            }

            // 1-5. (중요) 이메일 전송 "시뮬레이션"
            // (실제로는 여기서 Nodemailer로 이메일을 보냅니다)
            const resetLink = `http://localhost:3000/reset-password.html?token=${token}`;
            console.log('--- [비밀번호 재설정 시뮬레이션] ---');
            console.log(`[To]: ${email}`);
            console.log('[Message]: 비밀번호를 재설정하려면 아래 링크를 클릭하세요 (1시간 유효).');
            console.log(`[Link]: ${resetLink}`);
            console.log('------------------------------------');

            res.json({ success: true, message: '재설정 링크가 전송되었습니다 (콘솔을 확인하세요).' });
        });
    });
});

// 2. 비밀번호 재설정 실행 (토큰 검증 및 비밀번호 변경)
app.post('/reset-password', async (req, res) => {
    const { token, password } = req.body;

    if (!token || !password) {
        return res.status(400).json({ success: false, error: '토큰과 새 비밀번호가 필요합니다.' });
    }

    // 2-1. 토큰으로 사용자 찾기 (유효시간 1시간 이내)
    const sql = `SELECT * FROM users WHERE reset_token = ? AND reset_token_expires > ?`;
    db.get(sql, [token, Date.now()], async (err, row) => {
        if (err || !row) {
            return res.status(400).json({ success: false, error: '유효하지 않거나 만료된 토큰입니다.' });
        }

        // 2-2. 토큰이 유효하면 -> 새 비밀번호 암호화
        const saltRounds = 10;
        const password_hash = await bcrypt.hash(password, saltRounds);

        // 2-3. DB 업데이트 (새 비밀번호 저장, 사용한 토큰은 삭제)
        const updateSql = `UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?`;
        db.run(updateSql, [password_hash, row.id], (err) => {
            if (err) {
                return res.status(500).json({ success: false, error: '비밀번호 업데이트 중 오류' });
            }
            res.json({ success: true });
        });
    });
});


// (서버 실행)
app.listen(port, () => {
    console.log(`서버가 http://localhost:${port} 에서 실행 중입니다.`);
});