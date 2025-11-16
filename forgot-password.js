const forgotForm = document.getElementById('forgot-form');
const emailInput = document.getElementById('email');

forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value;

    try {
        const res = await fetch('/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        
        const result = await res.json();
        
        // (참고) 서버는 보안을 위해 이메일이 없어도 '성공'으로 응답합니다.
        if (result.success) {
            alert("요청이 처리되었습니다. 서버 콘솔 창을 확인하여 '시뮬레이션'된 재설정 링크를 복사하세요.");
        } else {
            alert(result.error || "요청에 실패했습니다.");
        }

    } catch (err) {
        console.error(err);
        alert("서버 통신 오류");
    }
});