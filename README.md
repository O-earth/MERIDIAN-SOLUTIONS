# MENAGERIE — Meridian Solutions 공식 사이트

GitHub Pages에 올리면 그대로 동작하는 정적 사이트입니다. 관리자 화면에서 오퍼레이터를 등록하면 이 저장소에 자동으로 커밋됩니다.

## 처음 한 번만 하는 설정

### 1. 저장소 만들고 파일 올리기
1. GitHub에서 새 저장소를 만듭니다 (예: `menagerie`). 무료 GitHub Pages는 **Public** 저장소에서만 됩니다.
2. 이 폴더 안의 파일을 **전부** 저장소 최상단에 올립니다. `.nojekyll` 파일도 같이 올려 주세요.
3. 저장소 → **Settings → Pages** → Source: `Deploy from a branch`, Branch: `main` / `(root)` → Save
4. 1~2분 뒤 `https://내아이디.github.io/menagerie/` 에서 열립니다.

### 2. 관리자 아이디·비밀번호 정하기
1. 사이트 주소 뒤에 `setup.html`을 붙여 엽니다.
2. 아이디·비밀번호를 넣고 **만들기**를 누릅니다.
3. 나온 두 줄(`adminId`, `passHash`)을 `config.js`의 같은 줄과 바꿔 저장소에 올립니다 (GitHub 웹에서 `config.js` → 연필 아이콘 → Commit changes).

`config.js`에는 해시값만 들어가므로 코드를 봐도 비밀번호는 알 수 없습니다.

### 3. GitHub 토큰 만들기 (저장용)
1. GitHub → 프로필 → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
2. Repository access: **Only select repositories** → 이 저장소 하나
3. Permissions → Repository permissions → **Contents: Read and write**
4. `github_pat_…` 토큰을 복사해 둡니다.

## 사용법
1. 맨 아래 **직원 전용**을 누르거나 주소 뒤에 `#staff`를 붙입니다.
2. 아이디·비밀번호로 인증하고, 처음 한 번은 **저장소 연결** 창에 토큰을 넣습니다. 토큰은 그 브라우저에만 저장됩니다.
3. 관리자 모드에서 할 수 있는 것
   - **오퍼레이터 명부**에서 `+ 오퍼레이터 등록`, 인사기록 창에서 수정·삭제 (사진, 분류, 인사 상태, 능력 평가 그래프, 관련 인물, 플랫폼 링크, 자유 항목)
   - 메인 화면에서 메인 이미지 등록
   - 등록 창의 **등록 전으로 올리기**를 체크하면 방문자에게는 사진만 보이고, 콜사인·분류·나머지 정보는 숨겨지며 인원 수에도 들어가지 않습니다. 정식 등록할 때 체크를 풀면 됩니다.
4. 저장하면 저장소에 커밋되고, 공개 사이트에는 **1~2분 뒤** 반영됩니다.

## 참고
- **공개 범위 주의:** 무료 GitHub Pages는 공개 저장소라서 `data/menagerie-data.js`를 누구나 열어볼 수 있습니다. 화면에서 가린 실명이나 등록 전인 오퍼레이터의 정보도 이 파일에는 그대로 들어 있습니다. 아직 숨기고 싶은 내용은 공개할 때까지 입력하지 않는 것이 안전합니다.
- **토큰:** 공용 기기에서 쓴 뒤에는 위쪽 **토큰 삭제** 버튼으로 이 브라우저에 저장된 GitHub 토큰을 지우세요.
- **자산 등록부:** 등록 창의 **등재 구분**을 `장비·비표준 자산`으로 하면 오퍼레이터 명부가 아니라 아래쪽 자산 등록부에 자산 번호와 함께 표시됩니다.
- 인사 상태를 **기록불일치(RECORD MISMATCH)**로 두면 카드에 겹친 사진·흔들린 콜사인 효과가 들어갑니다.
- 장비 목록 등재 같은 별도 표시는 등록 창의 자유 항목(예: `등재 구분 / 장비 목록`)으로 넣으면 됩니다.
- 저장소가 공개라서 저장소 파일(명부 데이터 포함)은 누구나 볼 수 있습니다. 실명 가리기는 화면에서만 가려집니다.
- 로고는 `assets/logo.png` 입니다. 바꾸려면 같은 이름으로 덮어쓰면 됩니다.
- 회사 소개·조직·채용·공지 문구는 `index.html`에서 직접 고칩니다.

## 파일 구조
| 파일 | 내용 |
|---|---|
| `index.html` | 사이트 본문 |
| `config.js` | 관리자 아이디, 비밀번호 해시, 저장소 정보 |
| `data/menagerie-data.js` | 오퍼레이터 명부와 메인 이미지 정보 (관리자 화면이 자동으로 고침) |
| `assets/agents/` | 오퍼레이터 사진 (자동으로 올라감) |
| `assets/logo.png` | 회사 로고 |
| `css/style.css`, `js/app.js`, `js/hash.js` | 디자인과 동작 |
| `setup.html` | 관리자 비밀번호 해시 만들기 |
