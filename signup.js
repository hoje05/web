const signupForm = document.getElementById('signup-form');
const usernameInput = document.getElementById('username');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const passwordConfirmInput = document.getElementById('password-confirm');

// 폼 제출 이벤트를 'async'로 만듭니다 (fetch를 기다리기 위해)
signupForm.addEventListener('submit', async function (event) {
    event.preventDefault();

    const username = usernameInput.value;
    const email = emailInput.value;
    const password = passwordInput.value;
    const passwordConfirm = passwordConfirmInput.value;

    if (password !== passwordConfirm) {
        alert("비밀번호가 일치하지 않습니다.");
        return;
    }

    // (변경점) 서버의 '/signup' API로 데이터를 보냅니다.
    try {
        const response = await fetch('/signup', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, email, password }),
        });

        const result = await response.json(); // 서버의 응답을 JSON으로 파싱

        if (result.success) {
            alert("회원가입 성공! 로그인 페이지로 이동합니다.");
            window.location.href = "index.html"; // 로그인 페이지로 이동
        } else {
            // 서버에서 보낸 에러 메시지 표시
            alert(result.error || "회원가입에 실패했습니다.");
        }

    } catch (error) {
        console.error('회원가입 요청 오류:', error);
        alert("서버 통신 중 오류가 발생했습니다.");
    }
});