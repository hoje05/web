const resetForm = document.getElementById('reset-form');
const passwordInput = document.getElementById('password');
const passwordConfirmInput = document.getElementById('password-confirm');

// 1. URL에서 토큰(token) 값 가져오기 (매우 중요)
const urlParams = new URLSearchParams(window.location.search);
const token = urlParams.get('token');

if (!token) {
    alert("유효하지 않은 접근입니다. 재설정 링크를 통해서만 접근 가능합니다.");
    window.location.href = 'index.html';
}

resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const password = passwordInput.value;
    const passwordConfirm = passwordConfirmInput.value;

    if (password !== passwordConfirm) {
        alert("새 비밀번호가 일치하지 않습니다.");
        return;
    }

    try {
        const res = await fetch('/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, password }), // 토큰과 새 비밀번호를 함께 전송
        });

        const result = await res.json();

        if (result.success) {
            alert("비밀번호가 성공적으로 변경되었습니다. 로그인 페이지로 이동합니다.");
            window.location.href = 'index.html';
        } else {
            alert(result.error || "비밀번호 변경에 실패했습니다. (토큰이 만료되었을 수 있습니다)");
        }
    } catch (err) {
        console.error(err);
        alert("서버 통신 오류");
    }
});