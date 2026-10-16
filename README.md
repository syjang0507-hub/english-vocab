# 영어 단어 암기 (Business English)

회의·계약·리포트에서 자주 쓰는 비즈니스 영어 표현을 10문제씩 시험 보는 웹 앱입니다.
빌드 도구 없이 HTML / CSS / JavaScript만으로 만들었습니다.

## 기능
- **시험**: 무작위 10문제. 표현과 예문, 그리고 맞는 뜻 또는 다른 표현의 뜻이 제시되고 `맞음` / `틀림`으로 판단합니다.
- **단어 관리**: 표현 추가·편집·삭제, 단어별 정답률, 등록일순 / 정답률순 정렬
- **시험 기록**: 회차별 점수와 정오표

## 데이터 저장
- **로그인 전**: 이 브라우저(localStorage)에 저장
- **Google 로그인 후**: Firebase Realtime Database `users/{uid}/`에 저장되어 기기 간 동기화. 처음 로그인하면 브라우저에 있던 데이터를 계정으로 옮깁니다.

```
users/{uid}/
  word_list: [{ id, english, korean, example, date, accuracy }]   # accuracy = 정답률(%), 시험 전이면 없음
  exam_list: [{ id, date, test: [{ english, korean, correct, shown, answer, word_id }] }]   # test = 10문제
  seed_version: 기본 단어 반영 버전
```
- 접근 권한: `database.rules.json` — 본인 계정 데이터만 읽기/쓰기 가능

## 파일
| 파일 | 내용 |
|---|---|
| `public/index.html` | 화면 구조 |
| `public/style.css` | 디자인 |
| `public/app.js` | 동작 로직 |
| `public/words.js` | 기본 단어 100개 (`[표현, 뜻, 예문]`) |
| `public/cloud.js` | Google 로그인, Firebase 저장 |
| `database.rules.json` | 데이터베이스 보안 규칙 |

## 배포
- 사이트: https://english-vocab-syjang.web.app
- Firebase Hosting이 `public/` 폴더만 배포합니다. 배포는 수동으로 `firebase deploy`를 실행합니다.
