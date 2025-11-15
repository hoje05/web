// 1. 필요한 프로그램들 (세션 관련 2줄 추가)
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const session = require('express-session'); // (새로 추가) 세션
const SQLiteStore = require('connect-sqlite3')(session); // (새로 추가) 세션 저장소

// 2. 서버 설정
const app = express();
const port = 3000;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// (새로 추가) 3. 세션 설정
// "secret-key"는 아무도 모르게 바꿔주세요.
app.use(session({
    store: new SQLiteStore({ db: 'sessions.db' }), // 세션 정보를 'sessions.db' 파일에 저장
    secret: 'your-very-secret-key', // 세션 암호화 키
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 쿠키 유효기간 (예: 1일)
}));

// 4. 데이터베이스(DB) 연결
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error('DB 연결 오류:', err.message);
    } else {
        console.log('데이터베이스에 성공적으로 연결되었습니다.');
        // (수정) 'users' 테이블에 role(역할) 컬럼 추가
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            email TEXT,
            password_hash TEXT,
            role TEXT DEFAULT 'user' 
        )`); // 'user' (일반사용자) 또는 'admin' (관리자)
    }
});

// 5. 프론트엔드 파일들 제공하기
app.use(express.static('.'));

// --- API (기능) 만들기 ---

// 6. 회원가입 API (/signup)
app.post('/signup', async (req, res) => {
    const { username, email, password } = req.body;

    // (수정) 첫 번째 가입자를 'admin'으로 자동 지정
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
                return res.status(400).json({ success: false, error: '이미 사용 중인 아이디입니다.' });
            }
            return res.status(500).json({ success: false, error: err.message });
        }
        res.json({ success: true });
    });
});

// 7. 로그인 API (/login)
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    const sql = `SELECT * FROM users WHERE username = ?`;
    db.get(sql, [username], async (err, row) => {
        if (err || !row) {
            return res.status(400).json({ success: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
        }

        const match = await bcrypt.compare(password, row.password_hash);

        if (match) {
            // (중요) 로그인 성공 시, 세션에 사용자 정보 저장
            req.session.user = {
                id: row.id,
                username: row.username,
                role: row.role // 'user' 또는 'admin'
            };
            // (수정) 성공 응답 시, role 정보도 함께 전달
            res.json({ success: true, role: row.role });
        } else {
            return res.status(400).json({ success: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
        }
    });
});

// (새로 추가) 8. 로그아웃 API (/logout)
app.post('/logout', (req, res) => {
    req.session.destroy((err) => { // 세션 파괴
        if (err) {
            return res.status(500).json({ success: false, error: '로그아웃 실패' });
        }
        res.clearCookie('connect.sid'); // 세션 쿠키 삭제
        res.json({ success: true });
    });
});

// (새로 추가) 9. 세션 확인 API (/check-session)
// (페이지가 로드될 때, "지금 로그인한 사람이 누군지" 확인하는 용도)
app.get('/check-session', (req, res) => {
    if (req.session.user) {
        // 로그인 상태 O
        res.json({ loggedIn: true, user: req.session.user });
    } else {
        // 로그인 상태 X
        res.json({ loggedIn: false });
    }
});


// --- (새로 추가) 관리자 전용 API ---

// (새로 추가) 10. 관리자인지 확인하는 '미들웨어' (보안 검문소)
const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        next(); // 통과 (관리자 맞음)
    } else {
        // 통과 실패 (관리자 아님)
        res.status(403).json({ success: false, error: '권한이 없습니다.' });
    }
};

// (새로 추가) 11. 모든 회원 목록 가져오기 (관리자 전용)
app.get('/api/users', isAdmin, (req, res) => { // 'isAdmin' 검문소를 통과해야만 실행됨
    const sql = "SELECT id, username, email, role FROM users";
    db.all(sql, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
        res.json({ success: true, users: rows });
    });
});

// (새로 추가) 12. 특정 회원 삭제하기 (관리자 전용)
app.delete('/api/users/:id', isAdmin, (req, res) => { // 'isAdmin' 검문소를 통과해야만 실행됨
    const id = req.params.id; // 주소에서 :id 값을 가져옴

    // (보안) 관리자 자기 자신은 삭제하지 못하게 막기
    if (req.session.user.id == id) {
        return res.status(400).json({ success: false, error: '자기 자신을 삭제할 수 없습니다.' });
    }

    const sql = "DELETE FROM users WHERE id = ?";
    db.run(sql, [id], function (err) {
        if (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
        if (this.changes === 0) {
            return res.status(404).json({ success: false, error: '사용자를 찾을 수 없습니다.' });
        }
        res.json({ success: true });
    });
});


// 13. 서버 실행
app.listen(port, () => {
    console.log(`서버가 http://localhost:${port} 에서 실행 중입니다.`);
});