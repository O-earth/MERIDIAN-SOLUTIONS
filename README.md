# MENAGERIE ROSTER

메나제리 대원 명단 사이트 (GitHub Pages용)

## 처음 한 번만 하는 설정

1. 이 폴더 전체를 GitHub 저장소에 올리고 Settings → Pages에서 `main` 브랜치를 켠다.
2. 브라우저에서 `setup.html`을 열고 쓸 아이디와 비밀번호를 넣는다. 그러면 나오는 두 줄(`adminId`, `passHash`)을 `config.js`에 붙여넣고 커밋한다.
   - 비밀번호는 원문이 아니라 해시로만 저장된다.
3. GitHub → Settings → Developer settings → Fine-grained tokens에서 토큰을 만든다.
   - Repository access: 이 저장소만
   - Permissions → Contents: **Read and write**

## 수정하는 법

1. 사이트 주소 뒤에 `#staff`를 붙이거나 맨 아래 **STAFF ONLY**를 누른다.
2. 로그인한다. 처음이면 토큰 입력창이 뜨는데, 위에서 만든 토큰을 넣으면 된다.
   - 토큰은 그 브라우저에만 저장되고 사이트 파일에는 들어가지 않는다.
3. 카드나 프로필의 **EDIT** 버튼으로 수정하고 저장한다. 저장하면 바로 저장소에 커밋된다.
   - Pages에 반영되기까지 1~2분 정도 걸린다.
4. 관리자 바에서 할 수 있는 것: **+ 대원 추가 / 상단 링크 / 저장소 연결 / 로그아웃**

## 메모

- 공개 상태가 "준비 중"이면 CLASSIFIED로 표시된다. 이미지만 보이고 이름과 정보는 가려진다.
- 번호는 등록 순서대로 붙는다. 편집창의 "번호(순서)"에서 바꿀 수 있다.
- 링크는 주소만 넣으면 케이브덕·티팟·유니챗 이름이 자동으로 붙는다.
- 데이터는 `data/roster-data.js`에, 이미지는 `images/`에 들어 있다.
- 주소 뒤에 `#KAKAPO`처럼 콜사인을 붙이면 해당 프로필이 바로 열린다.
