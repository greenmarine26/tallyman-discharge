=========================================
  Tallyman V38 패치 — 2026.05.03
=========================================

【수정 내용】
1. EDI BAPLIE 파서 강화 (가장 큰 버그)
   - V37: NAD+CF 만 처리 → 검수업체 정보 0건
   - V38: NAD+CA, NAD+CF 둘 다 처리 → 검수업체 100% 인식
   - LOC+76 (환적 추가 POL) 처리
   - ISO 4500/4200/2500/2200 등 4자리 숫자 코드 매핑
   - VGM 무게 우선, status 4/5 → F/E 매핑 강화

2. 엑셀 파일 ref 보정 (사용자 요청 핵심)
   - 회사 시스템이 만든 일부 .xlsx 는 sheet 안에
     dimension(범위)를 잘못 적어둠 (예: 실제 66행인데
     A1:Y5로 적힘) → SheetJS가 5행만 읽고 멈춤
   - V38: 실제 셀 키들로부터 범위 자동 재계산해서 보정
   - 결과: 받는 그대로 처리, 사용자가 엑셀 다시 저장 불필요

3. 엑셀 양식 호환성
   - 헤더 키워드: CNTNO, CNTR NO, CONTAINER No.,
     Container No, container#, 컨테이너번호 모두 인식
   - 실번호: SEAL, Seal No., 봉인번호 등
   - 병합셀로 인한 컬럼 어긋남 ±2 자동 보정

4. ASC 파서 보강 (보조용)
   - 코멘트 라인(***) 무시
   - 환적 라인 (NAD 다음 KRPTK 붙은 형식) 처리

【변경 파일】
   src/utils.js  ← 이 파일 1개만 교체
   (App.jsx, firebase.js, package.json 등 모두 V37과 동일)

【XTPG0521W 9개 엑셀 검증 결과】
   파일                                  V37   V38
   CLL_XTPG_EAS                          25    25  + 실번호 25
   CLL_XTPG_V-0521W_TCLC                 22    22  + 실번호 22
   cntr_number_list_xtp                  0     3   (원본에 3개만)
   JXTP0521W_CLL                         16    16
   XTPG_0521W__Excel_                    15    15  + 실번호 15
   XTPG_V-0521W_CBF_TCLC                 0     0   (예약양식, 정상)
   XTPG0521W_KRPTK_CLL                   0     40  ← !ref 보정
   XTPG0521WCN_CNNTG                     0     4   + 실번호 4
   XTPG0521WCN_CNTAG                     0     13  + 실번호 13

【EDI 검증 (XTPG-0521W.EDI 236대)】
   평택 선적: 180대
   검수업체: SIF 42 / CKL 40 / EAS 25 / TCL 22 /
            SIT 17 / DYS 16 / SKR 15 / TYS 3
   ASC 교차검증 100% 일치
