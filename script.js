const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');

loginForm.addEventListener('submit', async function (event) {
    event.preventDefault();

    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    if (username === "" || password === "") {
        alert("아이디와 비밀번호를 모두 입력해주세요.");
        return;
    }

    try {
        const response = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });

        const result = await response.json(); 

        if (result.success) {
            alert("로그인 성공!");

            // (중요) 서버가 알려준 'role'을 확인
            if (result.role === 'admin') {
                // 1. 관리자일 경우
                window.location.href = "admin.html";
            } else {
                // 2. 일반 사용자일 경우
                window.location.href = "main.html";
            }

        } else {
            alert(result.error || "로그인에 실패했습니다.");
        }

    } catch (error) {
        console.error('로그인 요청 오류:', error);
        alert("서버와 통신 중 오류가 발생했습니다.");
    }
});