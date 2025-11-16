// 1. 페이지가 로드되자마자 실행
document.addEventListener('DOMContentLoaded', async () => {
    
    // 2. (보안) 이 사람이 관리자가 맞는지 서버에 확인
    try {
        const res = await fetch('/check-session');
        const data = await res.json();

        if (!data.loggedIn || data.user.role !== 'admin') {
            // 관리자가 아니면, 로그인 페이지로 쫓아냄
            alert('접근 권한이 없습니다.');
            window.location.href = 'index.html';
            return;
        }

        // 3. 관리자가 맞다면, 회원 목록을 불러옴
        loadUserList();

    } catch (error) {
        console.error('세션 확인 오류:', error);
        window.location.href = 'index.html';
    }

    // 4. 로그아웃 버튼 기능
    document.getElementById('logout-btn').addEventListener('click', async () => {
        if (!confirm('로그아웃 하시겠습니까?')) return;
        
        try {
            await fetch('/logout', { method: 'POST' });
            alert('로그아웃 되었습니다.');
            window.location.href = 'index.html';
        } catch (error) {
            alert('로그아웃 중 오류 발생');
        }
    });
});

// 5. 회원 목록을 서버에서 가져와서 테이블을 채우는 함수
async function loadUserList() {
    try {
        const res = await fetch('/api/users'); // 관리자 API 호출
        const data = await res.json();

        if (!data.success) {
            alert(data.error || '회원 목록을 불러오는 데 실패했습니다.');
            return;
        }

        const tableBody = document.getElementById('user-table-body');
        tableBody.innerHTML = ''; // 테이블 비우기

        // 6. 각 회원을 테이블에 한 줄씩 추가
        data.users.forEach(user => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${user.id}</td>
                <td>${user.username}</td>
                <td>${user.email}</td>
                <td>${user.role}</td>
                <td>
                    <button class="delete-btn" data-id="${user.id}">삭제</button>
                </td>
            `;
            tableBody.appendChild(row);
        });

        // 7. 모든 '삭제' 버튼에 클릭 이벤트 추가
        tableBody.querySelectorAll('.delete-btn').forEach(button => {
            button.addEventListener('click', deleteUser);
        });

    } catch (error) {
        console.error('회원 목록 로드 오류:', error);
    }
}

// 8. 회원 삭제 함수
async function deleteUser(event) {
    const id = event.target.dataset.id; // 버튼에 저장된 data-id 값
    
    if (!confirm(`사용자 ID ${id}를 정말로 삭제하시겠습니까?`)) {
        return; // '취소' 누르면 중단
    }

    try {
        // 관리자 API로 삭제 요청
        const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
        const data = await res.json();

        if (data.success) {
            alert('사용자가 삭제되었습니다.');
            loadUserList(); // 테이블 새로고침
        } else {
            alert(data.error || '삭제에 실패했습니다.');
        }
    } catch (error) {
        console.error('사용자 삭제 오류:', error);
    }
}