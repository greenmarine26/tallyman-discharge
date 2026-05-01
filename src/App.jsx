// 그린마린 양하 검수앱 (모바일용, Firebase 실시간 동기화)
// 개발자: 연지아빠

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Search, MapPin, ArrowDownToLine, Upload, Check, X,
  ScanLine, FileText, Trash2, ChevronLeft, ChevronRight,
  RefreshCw, User, Cloud, CloudOff,
  Mic, MicOff, Volume2, VolumeX, Ship
} from 'lucide-react';
import { 
  fmtPos, formatWt, isoToLabel, 
  parseBAPLIE, parseAscFile, parseListExcel, parseXrayList 
} from './utils.js';
import {
  fbAddVoyage, fbUpdateVoyage, fbDeleteVoyage,
  fbCompleteContainer, fbCancelComplete,
  fbToggleXray, fbAddXrayBulk, fbSetXraySeal,
  fbSubscribeVoyages, fbSubscribeAllCompleted,
  fbSubscribeXray, fbSubscribeXraySeals,
  makeVoyageKey
} from './firebase.js';

const INSPECTOR_KEY = 'discharge_active_inspector';
const INSPECTORS_KEY = 'discharge_inspectors';
const ACTIVE_KEY = 'discharge_active_voyage';

export default function App() {
  const [voyagesAll, setVoyagesAll] = useState({});
  const [activeKey, setActiveKey] = useState(null);
  const [completedAll, setCompletedAll] = useState({});
  const [xrayList, setXrayList] = useState({});
  const [xraySeals, setXraySeals] = useState({});
  const [tab, setTab] = useState('list');
  const [query, setQuery] = useState('');
  const [selectedCn, setSelectedCn] = useState(null);
  const [inspector, setInspector] = useState('');
  const [inspectors, setInspectors] = useState([]);
  const [showInspectorModal, setShowInspectorModal] = useState(false);
  const [newInspectorName, setNewInspectorName] = useState('');
  const [online, setOnline] = useState(true);
  
  // 검수원 로드
  useEffect(() => {
    try {
      const i = localStorage.getItem(INSPECTOR_KEY);
      if (i) setInspector(i);
      else setShowInspectorModal(true);
      const list = localStorage.getItem(INSPECTORS_KEY);
      if (list) setInspectors(JSON.parse(list));
      const a = localStorage.getItem(ACTIVE_KEY);
      if (a) setActiveKey(a);
    } catch (e) {}
  }, []);
  
  // Firebase 실시간 구독
  useEffect(() => {
    const unsubV = fbSubscribeVoyages((data) => {
      // 양하 항차만 필터
      const filtered = {};
      for (const [k, v] of Object.entries(data)) {
        if (v.type === 'discharge') filtered[k] = v;
      }
      setVoyagesAll(filtered);
      setOnline(true);
    });
    const unsubC = fbSubscribeAllCompleted((data) => setCompletedAll(data));
    return () => { unsubV(); unsubC(); };
  }, []);
  
  // 활성 항차의 X-RAY 구독
  useEffect(() => {
    if (!activeKey) return;
    const unsubX = fbSubscribeXray(activeKey, (data) => setXrayList(data));
    const unsubXs = fbSubscribeXraySeals(activeKey, (data) => setXraySeals(data));
    return () => { unsubX(); unsubXs(); };
  }, [activeKey]);
  
  const saveInspector = (name) => {
    setInspector(name);
    localStorage.setItem(INSPECTOR_KEY, name);
    if (!inspectors.includes(name)) {
      const next = [...inspectors, name];
      setInspectors(next);
      localStorage.setItem(INSPECTORS_KEY, JSON.stringify(next));
    }
  };
  const saveActive = (k) => {
    setActiveKey(k);
    if (k) localStorage.setItem(ACTIVE_KEY, k);
    else localStorage.removeItem(ACTIVE_KEY);
  };
  
  const current = activeKey ? voyagesAll[activeKey] : null;
  const ediContainers = current?.ediContainers || [];
  const dischargeRecords = current?.dischargeRecords || [];
  const dischargeCns = useMemo(() => new Set(dischargeRecords.map(r => r.cn)), [dischargeRecords]);
  const completedMap = completedAll[activeKey] || {};
  
  const dischargeList = useMemo(() => {
    if (dischargeRecords.length === 0) return [];
    const ediByCn = {};
    for (const c of ediContainers) ediByCn[c.cn] = c;
    return dischargeRecords.map(r => {
      const edi = ediByCn[r.cn];
      if (edi) {
        // 리스트의 정보가 있으면 리스트 우선 + EDI 보충
        return { 
          ...edi, 
          sl: r.sl || edi.sl, 
          bl: r.bl || edi.bl, 
          wt: r.wt || edi.wt,
          fe: r.fe || edi.fe,
          iso: r.iso || edi.iso,
          op: r.op || edi.op,
          rf: r.rf || edi.rf,
          dg: r.dg || edi.dg,
          tmp: r.tmp || edi.tmp,
          pol: r.pol || edi.pol,
          pod: r.pod || edi.pod,
          _matched: true 
        };
      }
      // EDI 매칭 안 되어도 리스트 정보로 표시 (cn, sl, iso, wt, op 등)
      return { 
        cn: r.cn,
        sl: r.sl || '',
        bl: r.bl || '',
        wt: r.wt || 0,
        fe: r.fe || '',
        iso: r.iso || '',
        op: r.op || '',
        pol: r.pol || '',
        pod: r.pod || '',
        rf: r.rf || false,
        dg: r.dg || false,
        tmp: r.tmp || '',
        bay: '', row: '', tier: '',
        _matched: false 
      };
    });
  }, [dischargeRecords, ediContainers]);
  
  // EDI/ASC 의 컨테이너 정보도 리스트의 F/E 로 보정 (베이 화면용)
  const ediContainersFinal = useMemo(() => {
    if (dischargeRecords.length === 0) return ediContainers;
    const recordByCn = {};
    for (const r of dischargeRecords) recordByCn[r.cn] = r;
    
    // F/E 추론 함수 (실번호 + 무게 + 규격 기반)
    const inferFE = (sl, wt, iso) => {
      if (sl) return 'F'; // 실번호 있으면 F
      if (!wt || wt === 0) return null; // 무게 없으면 추론 불가
      const isoCheck = (iso || '').toUpperCase();
      const is20 = isoCheck.startsWith('22') || isoCheck.startsWith('20');
      const isReefer = /R[E51]/i.test(isoCheck);
      const threshold = isReefer ? 6000 : (is20 ? 3000 : 5000);
      return wt >= threshold ? 'F' : 'E';
    };
    
    return ediContainers.map(c => {
      const r = recordByCn[c.cn];
      if (!r) return c;
      
      // 리스트에 있는 컨이면 - 정보 합쳐서 F/E 추론
      const sl = r.sl || c.sl || '';
      const wt = r.wt || c.wt || 0;
      const iso = r.iso || c.iso || '';
      const fe = r.fe || inferFE(sl, wt, iso) || c.fe || 'F';
      
      return {
        ...c,
        fe,
        iso: r.iso || c.iso,
        op: r.op || c.op,
        wt: wt,
        sl: sl,
        bl: r.bl || c.bl,
        rf: r.rf || c.rf,
        dg: r.dg || c.dg,
        tmp: r.tmp || c.tmp,
        pol: r.pol || c.pol,
        pod: r.pod || c.pod,
      };
    });
  }, [ediContainers, dischargeRecords]);
  
  const searchResults = useMemo(() => {
    if (!query || query.length < 2) return [];
    const q = query.toUpperCase().replace(/\s+/g, '');
    const isFourDigit = /^\d{4}$/.test(q);
    const matchFn = (c) => {
      const cn = (c.cn || '').toUpperCase();
      if (isFourDigit) return cn.endsWith(q);
      return cn.includes(q) || (c.sl || '').toUpperCase().includes(q) || (c.bl || '').toUpperCase().includes(q);
    };
    return ediContainers.filter(matchFn).slice(0, 50);
  }, [query, ediContainers]);
  
  const completeContainer = async (cn, damaged = false) => {
    if (!activeKey || !inspector) {
      alert('검수원을 먼저 선택하세요');
      setShowInspectorModal(true);
      return;
    }
    try {
      await fbCompleteContainer(activeKey, cn, { by: inspector, damaged, side: 'discharge' });
      setQuery('');
      setSelectedCn(null);
    } catch (e) {
      alert('Firebase 저장 실패: ' + e.message);
      setOnline(false);
    }
  };
  const cancelComplete = async (cn) => {
    if (!activeKey) return;
    try { await fbCancelComplete(activeKey, cn); } catch (e) { alert('실패: ' + e.message); }
  };
  const toggleXray = async (cn) => {
    if (!activeKey) return;
    try { await fbToggleXray(activeKey, cn, !xrayList[cn]); } catch (e) { alert('실패: ' + e.message); }
  };
  const setXraySeal = async (cn, seal, eseal) => {
    if (!activeKey) return;
    try { await fbSetXraySeal(activeKey, cn, seal, eseal); } catch (e) { alert('실패: ' + e.message); }
  };
  
  // 항차 추가 (또는 기존 항차에 누적 합산)
  const addVoyage = async (vsl, voy, newContainers, etd = '', pol = '', source = 'EDI') => {
    const key = makeVoyageKey(vsl, voy, 'discharge');
    try {
      // 기존 항차 있으면 누적 합산
      const existing = voyagesAll[key];
      let mergedContainers = newContainers;
      let sources = [source];
      
      if (existing && existing.ediContainers) {
        // 컨번호 기준 합치기 (덮어쓰기 — 새 정보가 우선)
        const cnMap = {};
        // 기존 컨테이너 먼저
        for (const c of existing.ediContainers) {
          cnMap[c.cn] = { ...c };
        }
        // 새 컨테이너로 덮어쓰거나 추가 (원본 source 유지)
        for (const c of newContainers) {
          if (cnMap[c.cn]) {
            // 둘 다 있으면 source 표시 (비교용)
            cnMap[c.cn] = { ...cnMap[c.cn], ...c, _sources: [...new Set([...(cnMap[c.cn]._sources || [cnMap[c.cn]._source || 'OLD']), source])] };
          } else {
            cnMap[c.cn] = { ...c, _source: source, _sources: [source] };
          }
        }
        mergedContainers = Object.values(cnMap);
        sources = [...new Set([...(existing.sources || []), source])];
      } else {
        // 새 항차 - source 표시
        mergedContainers = newContainers.map(c => ({ ...c, _source: source, _sources: [source] }));
      }
      
      await fbAddVoyage(key, {
        vsl, voy, etd, pol, type: 'discharge',
        ediContainers: mergedContainers,
        dischargeRecords: existing?.dischargeRecords || [],
        sources,
      });
      saveActive(key);
      return { key, total: mergedContainers.length, added: newContainers.length };
    } catch (e) { alert('등록 실패: ' + e.message); }
  };
  
  // 양하 리스트 누적 합산
  const applyDischargeList = async (key, newRecords, isReplace = false) => {
    try {
      let merged;
      if (isReplace) {
        // 이미 메모리에서 누적된 전체 리스트로 교체
        merged = newRecords;
      } else {
        // 누적 합산 (단일 파일)
        const existing = voyagesAll[key];
        const existingRecords = existing?.dischargeRecords || [];
        const cnMap = {};
        for (const r of existingRecords) cnMap[r.cn] = r;
        for (const r of newRecords) cnMap[r.cn] = { ...cnMap[r.cn], ...r };
        merged = Object.values(cnMap);
      }
      
      await fbUpdateVoyage(key, { dischargeRecords: merged });
      return { total: merged.length, added: newRecords.length };
    } catch (e) { 
      alert('실패: ' + e.message); 
      return null;
    }
  };
  const deleteVoyage = async (key) => {
    if (!confirm(`항차 "${voyagesAll[key]?.vsl} ${voyagesAll[key]?.voy}" 를 Firebase 에서 삭제하시겠습니까?\n\n⚠ 모든 검수원의 데이터가 삭제됩니다`)) return;
    try {
      await fbDeleteVoyage(key);
      if (activeKey === key) saveActive(null);
    } catch (e) { alert('실패: ' + e.message); }
  };
  
  const isCompleted = (cn) => !!completedMap[cn];
  const completedInfo = (cn) => completedMap[cn];
  
  const selected = selectedCn ? ediContainers.find(c => c.cn === selectedCn) || dischargeList.find(c => c.cn === selectedCn) : null;
  
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* 검수원 선택 모달 */}
      {showInspectorModal && (
        <InspectorModal
          inspectors={inspectors}
          current={inspector}
          onSelect={(name) => { saveInspector(name); setShowInspectorModal(false); }}
          onAdd={(name) => { saveInspector(name); setNewInspectorName(''); setShowInspectorModal(false); }}
          newName={newInspectorName}
          setNewName={setNewInspectorName}
          onClose={() => inspector && setShowInspectorModal(false)}
        />
      )}
      
      <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-3 py-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <ArrowDownToLine className="w-5 h-5 text-blue-400 flex-shrink-0"/>
            <div className="min-w-0">
              <div className="font-bold text-sm sm:text-base text-blue-200 truncate">양하 검수</div>
              <div className="text-[10px] text-slate-500 truncate">
                {current ? `${current.vsl} ${current.voy}` : '항차 없음'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {online ? <Cloud className="w-3.5 h-3.5 text-emerald-400" title="실시간 연결됨"/> : <CloudOff className="w-3.5 h-3.5 text-red-400" title="오프라인"/>}
            <button onClick={() => setShowInspectorModal(true)}
              className="bg-amber-900/40 border border-amber-700/40 px-2 py-1 rounded text-xs flex items-center gap-1">
              <span className="w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center text-slate-900 text-[10px] font-black">{inspector[0] || '?'}</span>
              <span className="font-bold text-amber-200 max-w-[60px] truncate">{inspector || '검수원'}</span>
              <RefreshCw className="w-3 h-3 text-amber-400"/>
            </button>
          </div>
        </div>
      </header>
      
      <nav className="bg-slate-900 border-b border-slate-800 sticky top-[52px] z-30">
        <div className="max-w-7xl mx-auto px-1 flex gap-0.5 overflow-x-auto">
          {[
            { k: 'list', t: '양하리스트', i: ArrowDownToLine },
            { k: 'bay', t: '베이플랜', i: MapPin },
            { k: 'search', t: '검색', i: Search },
            { k: 'voyage', t: '항차관리', i: Upload },
          ].map(({k, t, i: Icon}) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-2.5 text-xs sm:text-sm font-bold flex items-center gap-1.5 border-b-2 transition whitespace-nowrap ${
                tab === k ? 'border-amber-400 text-amber-300' : 'border-transparent text-slate-400'
              }`}>
              <Icon className="w-4 h-4"/>{t}
            </button>
          ))}
        </div>
      </nav>
      
      <main className="max-w-7xl mx-auto px-3 py-4">
        {!current && tab !== 'voyage' && (
          <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg p-6 text-center">
            <Upload className="w-10 h-10 mx-auto mb-2 text-amber-400/60"/>
            <div className="text-amber-200 font-bold mb-1">활성 항차가 없습니다</div>
            <button onClick={() => setTab('voyage')} className="mt-3 bg-amber-500 hover:bg-amber-400 text-slate-900 px-4 py-2 rounded font-bold text-sm">
              항차 관리로
            </button>
          </div>
        )}
        {current && tab === 'list' && <DischargeListTab list={dischargeList} setSelectedCn={setSelectedCn} xrayList={xrayList} completedMap={completedMap} toggleXray={toggleXray}/>}
        {current && tab === 'bay' && <BayTab ediContainers={ediContainersFinal} dischargeCns={dischargeCns} xrayList={xrayList} setSelectedCn={setSelectedCn} completedMap={completedMap}/>}
        {tab === 'search' && <SearchTab query={query} setQuery={setQuery} results={searchResults} xrayList={xrayList} dischargeCns={dischargeCns} setSelectedCn={setSelectedCn} vsl={current?.vsl}/>}
        {tab === 'voyage' && <VoyageTab voyages={voyagesAll} activeKey={activeKey} setActiveKey={saveActive} addVoyage={addVoyage} deleteVoyage={deleteVoyage} applyDischargeList={applyDischargeList} addXrayBulk={(cnList) => fbAddXrayBulk(activeKey, cnList)}/>}
      </main>
      
      {selected && <DetailModal 
        c={selected}
        isDischarge={dischargeCns.has(selected.cn)}
        xrayMarked={!!xrayList[selected.cn]}
        toggleXray={() => toggleXray(selected.cn)}
        completed={isCompleted(selected.cn)}
        completedInfo={completedInfo(selected.cn)}
        onComplete={(d) => completeContainer(selected.cn, d)}
        onCancelComplete={() => cancelComplete(selected.cn)}
        xraySeal={xraySeals[selected.cn] || { seal: '', eseal: '' }}
        onSetXraySeal={(s, e) => setXraySeal(selected.cn, s, e)}
        onClose={() => setSelectedCn(null)}/>}
      
      <footer className="border-t border-slate-800 mt-8 py-3 text-center text-[10px] text-slate-500">
        양하 검수앱 · ☁ Firebase 실시간 동기화 · 개발자: <span className="text-amber-400">연지아빠</span>
      </footer>
    </div>
  );
}

function InspectorModal({ inspectors, current, onSelect, onAdd, newName, setNewName, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="text-xl font-bold text-amber-300 flex items-center gap-2">
          <User className="w-5 h-5"/>
          검수원 선택 / 교대
        </div>
        <div className="text-xs text-slate-400 bg-slate-800/50 p-2.5 rounded">
          💡 이 시점부터 모든 완료 처리는 선택된 검수원으로 기록됩니다 (실시간 Firebase 저장)
        </div>
        
        <div>
          <div className="text-xs text-amber-300 font-bold mb-1.5">+ 새 검수원</div>
          <div className="flex gap-2">
            <input type="text" value={newName} 
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && newName.trim() && onAdd(newName.trim())}
              placeholder="이름 입력"
              autoFocus
              className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm"/>
            <button onClick={() => newName.trim() && onAdd(newName.trim())}
              disabled={!newName.trim()}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-slate-900 rounded font-bold text-sm">
              시작
            </button>
          </div>
        </div>
        
        {inspectors.length > 0 && (
          <div>
            <div className="text-xs text-slate-400 font-bold mb-1.5">기존 검수원</div>
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {inspectors.map(name => (
                <button key={name} onClick={() => onSelect(name)}
                  className={`w-full px-3 py-2.5 rounded text-left flex items-center gap-2 ${
                    name === current ? 'bg-amber-500/20 border border-amber-500 text-amber-200' : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                  }`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black ${
                    name === current ? 'bg-amber-500 text-slate-900' : 'bg-slate-700 text-slate-300'
                  }`}>
                    {name[0]}
                  </div>
                  <div className="flex-1 mono font-bold">{name}</div>
                  {name === current && <span className="text-[10px] text-amber-300">현재</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DischargeListTab({ list, setSelectedCn, xrayList, completedMap, toggleXray }) {
  const [filter, setFilter] = useState('all');
  const [cargoFilter, setCargoFilter] = useState('all'); // 화물 종류 필터
  const [search, setSearch] = useState('');
  
  const total = list.length;
  const completedCount = list.filter(c => completedMap[c.cn]).length;
  const damagedCount = list.filter(c => completedMap[c.cn]?.damaged).length;
  const remaining = total - completedCount;
  
  // 화물 종류별 카운트
  const cargoCounts = useMemo(() => {
    const counts = { dg: 0, rf: 0, tk: 0, oog: 0, full: 0, empty: 0, hc: 0, dc20: 0, dc40: 0 };
    for (const c of list) {
      if (c.dg) counts.dg++;
      // 리퍼는 온도 있고 Full 만 카운트
      const hasTmp = c.tmp && String(c.tmp).trim() !== '' && String(c.tmp).trim() !== '0';
      if (c.rf && hasTmp && c.fe === 'F') counts.rf++;
      if (c.tk) counts.tk++;
      if (c.oog) counts.oog++;
      if (c.fe === 'F') counts.full++;
      else counts.empty++;
      const lbl = isoToLabel(c.iso);
      if (lbl === '40HC') counts.hc++;
      else if (lbl === '20DC') counts.dc20++;
      else if (lbl === '40DC') counts.dc40++;
    }
    return counts;
  }, [list]);
  
  const filtered = list.filter(c => {
    // 완료 상태 필터
    const info = completedMap[c.cn];
    if (filter === 'completed' && !info) return false;
    if (filter === 'remaining' && info) return false;
    if (filter === 'damaged' && !info?.damaged) return false;
    
    // 화물 종류 필터
    if (cargoFilter === 'dg' && !c.dg) return false;
    if (cargoFilter === 'rf' && !(c.rf && c.tmp && String(c.tmp).trim() !== '' && String(c.tmp).trim() !== '0' && c.fe === 'F')) return false;
    if (cargoFilter === 'tk' && !c.tk) return false;
    if (cargoFilter === 'oog' && !c.oog) return false;
    if (cargoFilter === 'full' && c.fe !== 'F') return false;
    if (cargoFilter === 'empty' && c.fe !== 'E') return false;
    if (cargoFilter === 'hc' && isoToLabel(c.iso) !== '40HC') return false;
    if (cargoFilter === '20' && !['20DC', '20GP'].includes(isoToLabel(c.iso))) return false;
    if (cargoFilter === '40' && !['40DC', '40GP'].includes(isoToLabel(c.iso))) return false;
    
    // 검색
    if (search.length >= 2) {
      const q = search.toUpperCase().replace(/\s+/g, '');
      const isFour = /^\d{4}$/.test(q);
      const cn = (c.cn || '').toUpperCase();
      const sl = (c.sl || '').toUpperCase();
      if (isFour) {
        if (!cn.endsWith(q)) return false;
      } else {
        if (!cn.includes(q) && !sl.includes(q)) return false;
      }
    }
    
    return true;
  });
  
  if (list.length === 0) {
    return <div className="bg-slate-900 border border-slate-800 rounded-lg p-12 text-center text-slate-500">
      <ArrowDownToLine className="w-12 h-12 mx-auto mb-3 opacity-30"/>
      양하 리스트가 없습니다.<br/>
      <span className="text-xs">항차관리에서 양하 리스트(엑셀)을 업로드하세요.</span>
    </div>;
  }
  
  return <div className="space-y-2">
    {/* 검색창 (양하리스트 안에 통합) */}
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500"/>
        <input type="text" value={search} 
          onChange={e => setSearch(e.target.value)}
          placeholder="끝 4자리 또는 컨번호/실번호"
          className="w-full pl-9 pr-9 py-2 bg-slate-800 border border-slate-700 rounded text-sm mono"/>
        {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded hover:bg-slate-700 flex items-center justify-center">
          <X className="w-4 h-4"/>
        </button>}
      </div>
    </div>
    
    {/* 완료 상태 필터 */}
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-2 flex flex-wrap items-center gap-1.5">
      <button onClick={() => setFilter('all')} className={`px-2.5 py-1 rounded text-[11px] font-bold ${filter === 'all' ? 'bg-amber-500 text-slate-900' : 'bg-slate-800 text-slate-300'}`}>전체 {total}</button>
      <button onClick={() => setFilter('completed')} className={`px-2.5 py-1 rounded text-[11px] font-bold ${filter === 'completed' ? 'bg-emerald-500 text-slate-900' : 'bg-slate-800 text-emerald-300'}`}>✓ 완료 {completedCount}</button>
      <button onClick={() => setFilter('remaining')} className={`px-2.5 py-1 rounded text-[11px] font-bold ${filter === 'remaining' ? 'bg-blue-500 text-slate-900' : 'bg-slate-800 text-blue-300'}`}>잔여 {remaining}</button>
      {damagedCount > 0 && <button onClick={() => setFilter('damaged')} className={`px-2.5 py-1 rounded text-[11px] font-bold ${filter === 'damaged' ? 'bg-orange-500 text-slate-900' : 'bg-slate-800 text-orange-300'}`}>⚠ 데미지 {damagedCount}</button>}
      <div className="ml-auto text-[11px] text-amber-300 font-bold">{total > 0 ? Math.round((completedCount / total) * 100) : 0}%</div>
    </div>
    
    {/* 화물 종류별 필터 */}
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-2 flex flex-wrap gap-1">
      <button onClick={() => setCargoFilter('all')} className={`px-2 py-1 rounded text-[10px] font-bold ${cargoFilter === 'all' ? 'bg-slate-600 text-white' : 'bg-slate-800 text-slate-400'}`}>모두</button>
      <button onClick={() => setCargoFilter('full')} className={`px-2 py-1 rounded text-[10px] font-bold ${cargoFilter === 'full' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-emerald-300'}`}>F {cargoCounts.full}</button>
      <button onClick={() => setCargoFilter('empty')} className={`px-2 py-1 rounded text-[10px] font-bold ${cargoFilter === 'empty' ? 'bg-slate-600 text-white' : 'bg-slate-800 text-slate-400'}`}>E {cargoCounts.empty}</button>
      <button onClick={() => setCargoFilter('20')} className={`px-2 py-1 rounded text-[10px] font-bold ${cargoFilter === '20' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-blue-300'}`}>20DC {cargoCounts.dc20}</button>
      <button onClick={() => setCargoFilter('40')} className={`px-2 py-1 rounded text-[10px] font-bold ${cargoFilter === '40' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-blue-300'}`}>40DC {cargoCounts.dc40}</button>
      <button onClick={() => setCargoFilter('hc')} className={`px-2 py-1 rounded text-[10px] font-bold ${cargoFilter === 'hc' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-blue-300'}`}>40HC {cargoCounts.hc}</button>
      {cargoCounts.rf > 0 && <button onClick={() => setCargoFilter('rf')} className={`px-2 py-1 rounded text-[10px] font-bold ${cargoFilter === 'rf' ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-cyan-300'}`}>❄ RF {cargoCounts.rf}</button>}
      {cargoCounts.dg > 0 && <button onClick={() => setCargoFilter('dg')} className={`px-2 py-1 rounded text-[10px] font-bold ${cargoFilter === 'dg' ? 'bg-red-600 text-white' : 'bg-slate-800 text-red-300'}`}>🔥 DG {cargoCounts.dg}</button>}
      {cargoCounts.tk > 0 && <button onClick={() => setCargoFilter('tk')} className={`px-2 py-1 rounded text-[10px] font-bold ${cargoFilter === 'tk' ? 'bg-orange-600 text-white' : 'bg-slate-800 text-orange-300'}`}>⬛ TK {cargoCounts.tk}</button>}
      {cargoCounts.oog > 0 && <button onClick={() => setCargoFilter('oog')} className={`px-2 py-1 rounded text-[10px] font-bold ${cargoFilter === 'oog' ? 'bg-purple-600 text-white' : 'bg-slate-800 text-purple-300'}`}>📐 OOG {cargoCounts.oog}</button>}

    </div>
    
    <div className="text-[10px] text-slate-500 px-1">
      {filtered.length}대 {(cargoFilter !== 'all' || filter !== 'all' || search) && '(필터 적용)'}
    </div>
    
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden divide-y divide-slate-800">
      {filtered.map((c, i) => {
        const info = completedMap[c.cn];
        const isComp = !!info;
        const isDmg = info?.damaged;
        // 화물 종류별 좌측 색깔 띠
        let typeBar = 'bg-slate-700';
        if (c.dg) typeBar = 'bg-red-500';
        else if (c.rf) typeBar = 'bg-cyan-500';
        else if (c.tk) typeBar = 'bg-orange-500';
        else if (c.oog) typeBar = 'bg-purple-500';
        else if (c.fe === 'F') typeBar = 'bg-emerald-500';
        else typeBar = 'bg-slate-500';
        
        return <div key={c.cn + i} onClick={() => setSelectedCn(c.cn)}
          className={`flex items-stretch cursor-pointer ${isDmg ? 'bg-orange-950/40' : isComp ? 'bg-emerald-950/30 opacity-60' : ''}`}>
          {/* 좌측 색깔 띠 (화물 종류) */}
          <div className={`w-1.5 ${typeBar}`}/>
          
          <div className="flex-1 px-3 py-2.5 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              {isDmg && <span className="text-orange-300">⚠</span>}
              {isComp && !isDmg && <span className="text-emerald-400">✓</span>}
              <span className="mono font-black text-sm text-blue-200">{c.cn}</span>
              <span className={`text-[9px] mono px-1 py-0.5 rounded font-bold ${c.fe === 'F' ? 'bg-emerald-900 text-emerald-300' : 'bg-slate-700 text-slate-300'}`}>{c.fe || 'F'}</span>
              <span className="text-[9px] mono px-1 py-0.5 rounded font-bold bg-blue-900 text-blue-300">{isoToLabel(c.iso)}</span>
              {c.dg && <span className="text-[9px] bg-red-700 text-white px-1 py-0.5 rounded font-bold">🔥 DG</span>}
              {c.rf && (c.tmp && String(c.tmp).trim() !== '' && String(c.tmp).trim() !== '0' && c.fe === 'F'
                ? <span className="text-[9px] bg-cyan-700 text-white px-1 py-0.5 rounded font-bold">❄ RF {c.tmp}°</span>
                : <span className="text-[9px] bg-cyan-900/70 text-cyan-300 px-1 py-0.5 rounded font-bold border border-cyan-700/50">RE</span>
              )}
              {c.tk && <span className="text-[9px] bg-orange-700 text-white px-1 py-0.5 rounded font-bold">⬛ TK</span>}
              {c.oog && <span className="text-[9px] bg-purple-700 text-white px-1 py-0.5 rounded font-bold">📐 OOG</span>}
            </div>
            {c.sl && <div className="text-[10px] mono text-amber-200 mt-0.5">실 {c.sl}</div>}
            <div className="flex items-center gap-2 mt-1 text-[10px] mono flex-wrap text-slate-400">
              {c.bay && <span className="text-amber-200 font-bold">{fmtPos(c)}</span>}
              {c.wt > 0 && <span>{formatWt(c.wt)}</span>}
              {c.pol && <span>POL {c.pol}</span>}
              {isComp && info?.by && <span className="text-emerald-300">[{info.by}]</span>}
            </div>
          </div>

        </div>;
      })}
      {filtered.length === 0 && <div className="p-8 text-center text-slate-500 text-sm">데이터 없음</div>}
    </div>
  </div>;
}

function BayTab({ ediContainers, dischargeCns, xrayList, setSelectedCn, completedMap }) {
  const [pageIdx, setPageIdx] = useState(0);
  const [zoom, setZoom] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) return 0.6;
    return 1.0;
  });
  const scrollRef = useRef(null);
  const containerRef = useRef(null);
  
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  
  // 평택 양하 대상 = POL 이 PTK 또는 KRPTK
  const isPtk = (c) => {
    const pol = (c.pol || '').toUpperCase();
    return pol === 'PTK' || pol === 'KRPTK' || pol.endsWith('PTK');
  };
  
  // 마우스/터치 드래그 + 휠 + 핀치 줌
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let isDown = false, startX = 0, startY = 0, scrollLeft = 0, scrollTop = 0;
    let pinchStartDist = 0, pinchStartZoom = 1;
    
    const onMouseDown = (e) => {
      if (e.target.closest('button')) return;
      isDown = true;
      startX = e.pageX - el.offsetLeft;
      startY = e.pageY - el.offsetTop;
      scrollLeft = el.scrollLeft;
      scrollTop = el.scrollTop;
      el.style.cursor = 'grabbing';
    };
    const onMouseUp = () => { isDown = false; el.style.cursor = 'grab'; };
    const onMouseMove = (e) => {
      if (!isDown) return;
      e.preventDefault();
      el.scrollLeft = scrollLeft - ((e.pageX - el.offsetLeft) - startX);
      el.scrollTop = scrollTop - ((e.pageY - el.offsetTop) - startY);
    };
    const onWheel = (e) => {
      // Ctrl + 휠 = 줌
      if (e.ctrlKey) {
        e.preventDefault();
        setZoom(z => Math.max(0.3, Math.min(3, z - e.deltaY * 0.001)));
      } else if (e.shiftKey) {
        // Shift + 휠 = 가로 스크롤
        el.scrollLeft += e.deltaY;
        e.preventDefault();
      }
      // 그 외는 브라우저 기본 (세로 스크롤)
    };
    
    // 터치 핀치 줌
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        pinchStartDist = dist(e.touches);
        pinchStartZoom = zoom;
      }
    };
    const onTouchMove = (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const newDist = dist(e.touches);
        const ratio = newDist / pinchStartDist;
        setZoom(Math.max(0.3, Math.min(3, pinchStartZoom * ratio)));
      }
    };
    
    el.style.cursor = 'grab';
    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    
    return () => {
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, [zoom]);
  
  // 시프팅 분석
  const shiftingMap = useMemo(() => {
    const result = { needsShift: {}, shiftCns: {} };
    if (!dischargeCns || dischargeCns.size === 0) return result;
    const tierZone = (t) => parseInt(t) >= 80 ? 'deck' : 'hold';
    for (const c of ediContainers) {
      if (!dischargeCns.has(c.cn)) continue;
      if (!c.bay || !c.tier) continue;
      const zone = tierZone(c.tier);
      const tier = parseInt(c.tier);
      const above = ediContainers.filter(o =>
        o.cn !== c.cn && !dischargeCns.has(o.cn) &&
        o.bay === c.bay && o.row === c.row &&
        o.tier && tierZone(o.tier) === zone &&
        parseInt(o.tier) > tier
      );
      if (above.length > 0) {
        result.needsShift[c.cn] = above.length;
        for (const a of above) result.shiftCns[a.cn] = true;
      }
    }
    return result;
  }, [ediContainers, dischargeCns]);
  
  // 베이별 그룹
  const bayGroups = useMemo(() => {
    const g = {};
    for (const c of ediContainers) {
      if (!c.bay) continue;
      if (!g[c.bay]) g[c.bay] = [];
      g[c.bay].push(c);
    }
    return g;
  }, [ediContainers]);
  
  // 모든 베이의 가장 큰 좌현/우현 ROW 번호 (전체 통일 폭)
  const globalRowRange = useMemo(() => {
    let maxLeft = 0, maxRight = 0;
    for (const c of ediContainers) {
      if (!c.row) continue;
      const n = parseInt(c.row);
      if (n === 0) continue;
      if (n % 2 === 0) maxLeft = Math.max(maxLeft, n);
      else maxRight = Math.max(maxRight, n);
    }
    return { maxLeft, maxRight };
  }, [ediContainers]);
  
  // 페이지 = 짝수/홀수 베이 한 쌍 (PDF 처럼)
  // 빈 베이도 표시 (1번~최대번호까지 연속)
  const pages = useMemo(() => {
    const bays = Object.keys(bayGroups).sort();
    if (bays.length === 0) return [];
    
    // 베이 번호 자릿수 (보통 2자리 또는 3자리)
    const bayLen = bays[0].length;
    
    // 최대 베이 번호 찾기
    const maxBay = Math.max(...bays.map(b => parseInt(b)));
    
    const out = [];
    
    // 짝수 베이 1번부터 maxBay 까지 (홀수 베이는 짝수 베이와 함께 표시)
    for (let n = 1; n <= maxBay; n++) {
      // 짝수 베이가 메인, 홀수는 짝수+1
      // 일반적으로 컨테이너 베이는 홀수가 20', 짝수가 40' (홀수 두개 = 짝수 한개)
      if (n % 2 === 0) {
        // 짝수 베이 페이지 (홀수 베이 = 같은 페이지)
        const evenStr = String(n).padStart(bayLen, '0');
        const oddBefore = String(n - 1).padStart(bayLen, '0');
        const oddAfter = String(n + 1).padStart(bayLen, '0');
        
        const hasEven = bays.includes(evenStr);
        const hasOdd = bays.includes(oddAfter);
        
        // 데이터가 있는 베이만 표시할지, 빈 베이도 표시할지
        // → 빈 베이도 표시
        out.push({
          title: `BAY ${evenStr}${hasOdd || bays.includes(oddAfter) ? ` / ${oddAfter}` : ''}`,
          evenBay: evenStr,
          oddBay: oddAfter,
          isEmpty: !hasEven && !hasOdd,
        });
      }
    }
    
    // 마지막에 홀수 베이 1번 (보통 선수 부분) 따로 추가
    if (bays.includes(String(1).padStart(bayLen, '0'))) {
      out.unshift({
        title: `BAY ${String(1).padStart(bayLen, '0')}`,
        evenBay: null,
        oddBay: String(1).padStart(bayLen, '0'),
        isEmpty: false,
      });
    }
    
    return out;
  }, [bayGroups]);
  
  if (pages.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-12 text-center text-slate-500">
        <MapPin className="w-12 h-12 mx-auto mb-3 opacity-30"/>
        베이 데이터 없음
      </div>
    );
  }
  
  const safeIdx = Math.min(pageIdx, pages.length - 1);
  const currentPage = pages[safeIdx];
  
  // 현재 페이지 컨테이너들
  const pageContainers = [
    ...(currentPage.evenBay ? bayGroups[currentPage.evenBay] || [] : []),
    ...(currentPage.oddBay ? bayGroups[currentPage.oddBay] || [] : []),
  ];
  
  // ROW/TIER 자동 추출 (ASC 정보로 베이 모양 파악)
  // ROW 순서: 좌현 짝수 큰→작은, 가운데 00, 01, 우현 홀수 작은→큰
  const sortRows = (rows) => {
    const arr = Array.from(new Set(rows));
    // 좌현 (짝수, 00 제외): 큰 번호 왼쪽 → 작은 번호 가운데쪽
    // 가운데: 00
    // 우현 (홀수): 작은 번호 왼쪽 (가운데) → 큰 번호 오른쪽
    return arr.sort((a, b) => {
      const na = parseInt(a), nb = parseInt(b);
      const aEven = na % 2 === 0, bEven = nb % 2 === 0;
      // 둘 다 짝수 (00 포함)
      if (aEven && bEven) {
        // 00 은 짝수 그룹의 가장 마지막 (오른쪽 끝)
        if (na === 0) return 1;
        if (nb === 0) return -1;
        return nb - na; // 큰 번호가 왼쪽
      }
      // 둘 다 홀수
      if (!aEven && !bEven) return na - nb; // 작은 번호가 왼쪽
      // 짝수 vs 홀수 → 짝수가 먼저 (왼쪽)
      return aEven ? -1 : 1;
    });
  };
  
  // 베이 구조 사전 분석 (빈 슬롯 포함하여 전체 row/tier 범위 추출)
  const bayStructureMap = useMemo(() => {
    const map = {}; // { bay: { rows: Set, deckTiers: Set, holdTiers: Set } }
    for (const c of ediContainers) {
      if (!c.bay) continue;
      if (!map[c.bay]) map[c.bay] = { rows: new Set(), deckTiers: new Set(), holdTiers: new Set() };
      if (c.row) map[c.bay].rows.add(c.row);
      if (c.tier) {
        if (parseInt(c.tier) >= 80) map[c.bay].deckTiers.add(c.tier);
        else map[c.bay].holdTiers.add(c.tier);
      }
    }
    return map;
  }, [ediContainers]);
  
  // DECK / HOLD 분리 (페이지 컨테이너만)
  const deckContainers = pageContainers.filter(c => parseInt(c.tier) >= 80);
  const holdContainers = pageContainers.filter(c => parseInt(c.tier) < 80);
  
  // ROW/TIER 추출: 페이지의 베이 구조를 합산
  const pageBayKeys = [currentPage.evenBay, currentPage.oddBay].filter(Boolean);
  const allRowsInPage = new Set();
  const allDeckTiers = new Set();
  const allHoldTiers = new Set();
  for (const bk of pageBayKeys) {
    const bs = bayStructureMap[bk];
    if (!bs) continue;
    for (const r of bs.rows) allRowsInPage.add(r);
    for (const t of bs.deckTiers) allDeckTiers.add(t);
    for (const t of bs.holdTiers) allHoldTiers.add(t);
  }
  
  const deckRows = sortRows([...allRowsInPage]);
  const deckTiers = [...allDeckTiers].sort((a, b) => parseInt(b) - parseInt(a));
  const holdRows = sortRows([...allRowsInPage]);
  const holdTiers = [...allHoldTiers].sort((a, b) => parseInt(b) - parseInt(a));
  
  // 셀 찾기
  const getCell = (row, tier) => {
    return pageContainers.find(c => c.row === row && c.tier === tier);
  };
  
  // 셀 색깔 (파스텔)
  const cellColor = (c) => {
    if (completedMap[c.cn]) {
      // 완료 = 흰색
      return 'bg-white text-slate-700 border-slate-300';
    }
    if (xrayList[c.cn]) {
      // X-RAY = 파스텔 보라
      return 'bg-purple-200 text-purple-900 border-purple-400 ring-1 ring-purple-300';
    }
    if (shiftingMap.shiftCns[c.cn]) {
      // 시프팅 대상 (위에 있는 컨) = 파스텔 주황
      return 'bg-orange-200 text-orange-900 border-orange-400';
    }
    if (isPtk(c) || dischargeCns.has(c.cn)) {
      // 평택 양하 = 파스텔 노랑 (형광펜 같이)
      return 'bg-yellow-200 text-yellow-900 border-yellow-500 ring-1 ring-yellow-400';
    }
    // 통과 화물 = 옅은 회색
    return 'bg-slate-100 text-slate-500 border-slate-300';
  };
  
  // 셀 너비/높이 (zoom 적용) - PDF 5줄 다 보이게
  const baseW = isMobile ? 110 : 140;
  const baseH = isMobile ? 88 : 108;
  const cellW = Math.round(baseW * zoom);
  const cellH = Math.round(baseH * zoom);
  const fontSize = Math.max(8, Math.round(10 * zoom));
  
  // 한 셀 렌더링 (4줄 PDF 형식)
  const renderCell = (row, tier) => {
    const c = getCell(row, tier);
    const key = `${row}-${tier}`;
    
    if (!c) {
      // 컨 없음 → 빈 칸 또는 X (40피트가 차지한 자리는 별도 처리 어려우니 빈칸)
      return (
        <div key={key} 
          className="border border-dashed border-slate-700/50 flex-shrink-0"
          style={{ width: cellW, height: cellH }}
        />
      );
    }
    
    const sm = shiftingMap;
    const needsShift = sm.needsShift[c.cn];
    const ptk = isPtk(c);
    const fe = c.fe || 'F';
    const wt = c.wt > 0 ? (c.wt / 1000).toFixed(1) : '';
    const typeLabel = isoToLabel(c.iso);
    const polLabel = (c.pol || '').replace(/^KR/, '').slice(0, 3);
    const podLabel = (c.pod || '').replace(/^KR/, '').slice(0, 3);
    const transit = c.tr ? c.tr.slice(0, 3) : '';
    
    return (
      <button
        key={key}
        onClick={() => setSelectedCn(c.cn)}
        className={`relative border ${cellColor(c)} hover:brightness-110 active:scale-95 transition flex-shrink-0 overflow-hidden`}
        style={{ width: cellW, height: cellH, padding: 1, fontSize }}
      >
        {needsShift && (
          <div className="absolute top-0 left-0 bg-amber-400 text-slate-900 px-0.5 font-black leading-none rounded-br" style={{ fontSize: fontSize - 1 }}>
            ⬆{needsShift}
          </div>
        )}
        {(c.dg || c.rf || c.tk) && (
          <div className="absolute top-0 right-0 leading-none" style={{ fontSize: fontSize - 1 }}>
            {c.dg && '🔥'}{c.rf && '❄'}{c.tk && '⬛'}
          </div>
        )}
        <div className="text-left mono leading-tight" style={{ fontSize: fontSize - 1 }}>
          <div className="font-bold truncate">
            {polLabel}/{transit && `${transit}`}*<span className={ptk ? 'text-red-700' : ''}>{podLabel}</span>
          </div>
          <div className="font-black truncate" style={{ fontSize }}>
            {isMobile ? (c.cn || '').slice(-7) : c.cn}
          </div>
          <div className="truncate opacity-80">
            {fe} {wt} {typeLabel}
          </div>
          {c.tmp && <div className="text-cyan-700 font-bold truncate">{c.tmp}°C</div>}
        </div>
      </button>
    );
  };
  
  // 통계
  const ptkCount = pageContainers.filter(c => isPtk(c) || dischargeCns.has(c.cn)).length;
  const completedCount = pageContainers.filter(c => completedMap[c.cn]).length;
  const shiftCount = Object.keys(shiftingMap.needsShift).filter(cn => 
    pageContainers.some(c => c.cn === cn)
  ).length;
  
  // 전체 통합 모드 (모바일에서 1번~끝까지 한 번에 스크롤)
  const [allBaysMode, setAllBaysMode] = useState(false);
  
  return (
    <div className="space-y-2">
      {/* 헤더 */}
      <div className="bg-blue-900/20 border border-blue-700/40 rounded-lg p-2.5 flex flex-wrap items-center gap-2 text-xs">
        <div className="font-bold flex items-center gap-1.5 text-blue-200">
          <ArrowDownToLine className="w-4 h-4 text-blue-400"/>
          {currentPage.title}
          <span className="text-[10px] text-slate-500">({safeIdx + 1}/{pages.length})</span>
        </div>
        <span className="text-slate-400">평택: <span className="font-bold mono text-yellow-300">{ptkCount}</span></span>
        <span className="text-slate-400">완료: <span className="font-bold mono text-emerald-300">{completedCount}</span></span>
        {shiftCount > 0 && (
          <span className="bg-orange-900/40 border border-orange-600/50 text-orange-200 px-2 py-0.5 rounded text-[10px] font-bold">
            ⚠ 시프팅 {shiftCount}
          </span>
        )}
      </div>
      
      {/* 컨트롤 — 줌, 페이지, 전체모드 */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-2 flex flex-wrap items-center gap-1.5">
        <div className="flex items-center gap-1">
          <button onClick={() => setZoom(z => Math.max(0.3, z - 0.2))} 
            className="w-9 h-9 bg-slate-800 hover:bg-slate-700 rounded font-bold text-lg">−</button>
          <div className="w-12 text-center text-xs mono">{Math.round(zoom * 100)}%</div>
          <button onClick={() => setZoom(z => Math.min(3, z + 0.2))} 
            className="w-9 h-9 bg-slate-800 hover:bg-slate-700 rounded font-bold text-lg">+</button>
          <button onClick={() => setZoom(isMobile ? 0.6 : 1.0)} 
            className="px-2 h-9 bg-slate-800 hover:bg-slate-700 rounded text-[10px]">기본</button>
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <button onClick={() => setAllBaysMode(m => !m)}
            className={`px-3 h-9 rounded text-[10px] font-bold ${allBaysMode ? 'bg-amber-500 text-slate-900' : 'bg-slate-800 text-slate-300'}`}>
            {allBaysMode ? '✓ 전체보기' : '전체보기'}
          </button>
        </div>
        {!allBaysMode && (
          <div className="flex gap-1 w-full sm:w-auto">
            <button onClick={() => setPageIdx(Math.max(0, safeIdx - 1))} disabled={safeIdx === 0} 
              className="flex-1 sm:flex-none w-12 h-9 bg-slate-800 hover:bg-slate-700 rounded flex items-center justify-center disabled:opacity-30">
              <ChevronLeft className="w-4 h-4"/>
            </button>
            <select value={safeIdx} onChange={e => setPageIdx(parseInt(e.target.value))}
              className="px-2 h-9 bg-slate-800 border border-slate-700 rounded text-xs mono">
              {pages.map((p, i) => <option key={i} value={i}>{p.title}</option>)}
            </select>
            <button onClick={() => setPageIdx(Math.min(pages.length - 1, safeIdx + 1))} disabled={safeIdx === pages.length - 1}
              className="flex-1 sm:flex-none w-12 h-9 bg-slate-800 hover:bg-slate-700 rounded flex items-center justify-center disabled:opacity-30">
              <ChevronRight className="w-4 h-4"/>
            </button>
          </div>
        )}
      </div>
      
      {/* 범례 */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-2 flex flex-wrap gap-2 text-[10px]">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-200 border border-yellow-500"></span>평택 양하</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-200 border border-orange-400"></span>시프팅</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-white border border-slate-300"></span>완료</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-100 border border-slate-300"></span>통과</span>
      </div>
      
      {/* 베이 그림 */}
      <div ref={scrollRef} 
        className="bg-white border border-slate-700 rounded-lg p-3 overflow-auto"
        style={{ touchAction: 'pan-x pan-y', minHeight: isMobile ? '70vh' : '80vh', maxHeight: isMobile ? '78vh' : '85vh' }}
      >
        {allBaysMode ? (
          // 전체 베이 모드: 1번부터 끝까지 위→아래 스크롤
          <div className="space-y-6">
            {pages.map((page, pIdx) => (
              <BaySection key={pIdx}
                page={page}
                bayGroups={bayGroups}
                completedMap={completedMap}
                xrayList={xrayList}
                dischargeCns={dischargeCns}
                shiftingMap={shiftingMap}
                isPtk={isPtk}
                setSelectedCn={setSelectedCn}
                cellW={cellW} cellH={cellH} fontSize={fontSize}
                isMobile={isMobile}
                cellColor={cellColor}
                globalRowRange={globalRowRange}
                bayStructureMap={bayStructureMap}
              />
            ))}
          </div>
        ) : (
          // 단일 페이지 모드
          <BaySection
            page={currentPage}
            bayGroups={bayGroups}
            completedMap={completedMap}
            xrayList={xrayList}
            dischargeCns={dischargeCns}
            shiftingMap={shiftingMap}
            isPtk={isPtk}
            setSelectedCn={setSelectedCn}
            cellW={cellW} cellH={cellH} fontSize={fontSize}
            isMobile={isMobile}
            cellColor={cellColor}
            globalRowRange={globalRowRange}
            bayStructureMap={bayStructureMap}
          />
        )}
      </div>
      
      {/* 모바일 안내 */}
      {isMobile && (
        <div className="text-[10px] text-slate-500 text-center">
          💡 두 손가락으로 확대/축소 · 한 손가락으로 스크롤
        </div>
      )}
    </div>
  );
}

// === 베이 한 페이지 (DECK + 해치커버 + HOLD) ===
// === 베이 한 페이지 — 5:5 비율 + X 표시 + 전체 베이 가운데 정렬 ===
function BaySection({ page, bayGroups, completedMap, xrayList, dischargeCns, shiftingMap, isPtk, setSelectedCn, cellW, cellH, fontSize, isMobile, cellColor, globalRowRange, bayStructureMap }) {
  // 짝수 베이 컨 (40피트)
  const evenContainers = page.evenBay ? (bayGroups[page.evenBay] || []) : [];
  // 홀수 베이 컨 (20피트)
  const oddContainers = page.oddBay ? (bayGroups[page.oddBay] || []) : [];
  const allContainers = [...evenContainers, ...oddContainers];
  
  // 짝수 베이 (40피트) 가 차지한 ROW 위치 — TIER 별로 모음
  // 40피트 컨이 ROW 10 에 있으면 → 같은 TIER 의 ROW 09 자리에 X 표시
  // 40피트 컨이 ROW 06 에 있으면 → 같은 TIER 의 ROW 05 자리에 X 표시
  // 규칙: 짝수 ROW N → 그 다음 작은 홀수 ROW (N-1) 에 X
  const xMarks = useMemo(() => {
    const marks = new Set(); // "row-tier" 형식 키
    for (const c of evenContainers) {
      if (!c.row || !c.tier) continue;
      const evenN = parseInt(c.row);
      if (evenN === 0 || evenN % 2 !== 0) continue;
      // 짝수 ROW N 의 40피트 → 홀수 ROW (N-1) 자리에 X
      const oddN = evenN - 1;
      if (oddN < 0) continue;
      const oddRow = String(oddN).padStart(2, '0');
      marks.add(`${oddRow}-${c.tier}`);
    }
    return marks;
  }, [evenContainers]);
  
  // ROW 정렬
  const sortRows = (rows) => {
    const arr = Array.from(new Set(rows));
    return arr.sort((a, b) => {
      const na = parseInt(a), nb = parseInt(b);
      const aEven = na % 2 === 0, bEven = nb % 2 === 0;
      if (aEven && bEven) {
        if (na === 0) return 1;
        if (nb === 0) return -1;
        return nb - na;
      }
      if (!aEven && !bEven) return na - nb;
      return aEven ? -1 : 1;
    });
  };
  
  // X 표시 위치도 ROW 에 포함시켜야 함 (없는 ROW 라도 표시 필요)
  // V29: bayStructureMap 에서 베이 전체의 row 도 가져옴 (빈 슬롯도 표시)
  const fullRowsFromStructure = [];
  if (bayStructureMap) {
    for (const bk of [page.evenBay, page.oddBay].filter(Boolean)) {
      const bs = bayStructureMap[bk];
      if (bs) for (const r of bs.rows) fullRowsFromStructure.push(r);
    }
  }
  const allRowsRaw = sortRows([
    ...allContainers.map(c => c.row),
    ...Array.from(xMarks).map(k => k.split('-')[0]),
    ...fullRowsFromStructure
  ]);
  
  // 좌우 5:5 균형 — 모든 베이 통일 폭 (00 이 전체에서 같은 위치)
  const maxLeft = globalRowRange?.maxLeft || 0;
  const maxRight = globalRowRange?.maxRight || 0;
  
  // 모든 짝수 ROW (좌현): maxLeft, maxLeft-2, ..., 04, 02
  const allLeftRows = [];
  for (let n = maxLeft; n >= 2; n -= 2) {
    allLeftRows.push(String(n).padStart(2, '0'));
  }
  // 모든 홀수 ROW (우현): 01, 03, ..., maxRight
  const allRightRows = [];
  for (let n = 1; n <= maxRight; n += 2) {
    allRightRows.push(String(n).padStart(2, '0'));
  }
  
  // 00 은 가운데 (항상 표시)
  const centerRows = ['00'];
  
  const allRows = [...allLeftRows, ...centerRows, ...allRightRows];
  
  // DECK / HOLD 분리
  const allTiers = Array.from(new Set([
    ...allContainers.map(c => c.tier),
    ...Array.from(xMarks).map(k => k.split('-')[1])
  ]));
  const deckTiers = allTiers.filter(t => parseInt(t) >= 80).sort((a, b) => parseInt(b) - parseInt(a));
  const holdTiers = allTiers.filter(t => parseInt(t) < 80).sort((a, b) => parseInt(b) - parseInt(a));
  
  // 상하 5:5 균형 — DECK 와 HOLD 같은 단 개수
  const tierMax = Math.max(deckTiers.length, holdTiers.length);
  const deckTiersPadded = [
    ...Array(tierMax - deckTiers.length).fill(null),
    ...deckTiers
  ];
  const holdTiersPadded = [
    ...holdTiers,
    ...Array(tierMax - holdTiers.length).fill(null)
  ];
  
  const getCell = (row, tier) => {
    if (!row || !tier) return null;
    return allContainers.find(c => c.row === row && c.tier === tier);
  };
  
  const isXmark = (row, tier) => {
    if (!row || !tier) return false;
    return xMarks.has(`${row}-${tier}`);
  };
  
  // 한 셀 렌더링
  const renderCell = (row, tier) => {
    const key = `${row || '_'}-${tier || '_'}`;
    
    // 빈칸 (TIER 또는 ROW 가 더미)
    if (!row || !tier) {
      return (
        <div key={key} className="border border-dashed border-slate-300 flex-shrink-0 bg-slate-50/30"
          style={{ width: cellW, height: cellH }}/>
      );
    }
    
    // X 표시 (40피트 차지)
    if (isXmark(row, tier)) {
      return (
        <div key={key} 
          className="border border-slate-400 bg-slate-100 flex-shrink-0 flex items-center justify-center"
          style={{ width: cellW, height: cellH }}>
          <span className="text-slate-500 font-black" style={{ fontSize: fontSize * 2.5 }}>×</span>
        </div>
      );
    }
    
    const c = getCell(row, tier);
    
    if (!c) {
      // 빈 셀 (컨 없음)
      return (
        <div key={key} className="border border-dashed border-slate-300 flex-shrink-0 bg-white"
          style={{ width: cellW, height: cellH }}/>
      );
    }
    
    // 컨테이너 셀 — PDF 5줄 형식 (고정폭 정렬)
    const needsShift = shiftingMap.needsShift[c.cn];
    const ptk = isPtk(c);
    const fe = c.fe || 'F';
    const wt = c.wt > 0 ? (c.wt / 1000).toFixed(1) : '0.0';
    const typeLabel = isoToLabel(c.iso) || '';
    const polLabel = (c.pol || '').replace(/^KR/, '').slice(0, 3).padEnd(3, ' ');
    const podLabel = (c.pod || '').replace(/^KR/, '').slice(0, 3);
    const transit = (c.transit || '').slice(0, 3);
    const opLabel = (c.op || '').slice(0, 3).padEnd(3, ' ');
    
    // 위치: ....BAYROWTIER (BAY 2자리, ROW 2자리, TIER 2자리)
    const bay2 = String(parseInt(c.bay || '0')).padStart(2, '0');
    const posStr = `....${bay2}${row}${tier}`;
    
    // 4줄: 특수 정보
    let specialLine = '';
    let specialColor = 'text-slate-700';
    if (c.dg) {
      specialLine = c.un ? `DG UN${c.un}` : 'DG';
      specialColor = 'text-red-700 font-bold';
    } else if (c.rf && c.tmp) {
      // 14.0 → "14.0C", -24.0 → "-24.0C"
      specialLine = `${c.tmp}C`;
      specialColor = 'text-cyan-700 font-bold';
    } else if (c.rf) {
      specialLine = 'REEFER';
      specialColor = 'text-cyan-700 font-bold';
    } else if (c.tk) {
      specialLine = 'TANK';
      specialColor = 'text-orange-700 font-bold';
    } else if (c.fr) {
      specialLine = 'FR';
      specialColor = 'text-purple-700 font-bold';
    } else if (c.oog) {
      specialLine = 'OOG';
      specialColor = 'text-purple-700 font-bold';
    }
    
    // PDF 정렬: "LYG/   *PTK" — / 다음에 공백 패딩 (transit 자리)
    const line1 = transit 
      ? `${polLabel}/${transit}*${podLabel}`
      : `${polLabel}/   *${podLabel}`;
    
    // PDF 정렬: "LYG E  6.0 4530" — 공백으로 칸 맞춤
    const wtPadded = wt.padStart(4, ' '); // "6.0" → " 6.0", "27.7" → "27.7"
    const line3 = `${opLabel} ${fe}${wtPadded} ${typeLabel}`;
    
    return (
      <button
        key={key}
        onClick={() => setSelectedCn(c.cn)}
        className={`relative border ${cellColor(c)} hover:brightness-95 active:scale-95 transition flex-shrink-0 overflow-hidden`}
        style={{ width: cellW, height: cellH, padding: '3px 4px', fontSize }}
      >
        {needsShift && (
          <div className="absolute top-0 left-0 bg-amber-500 text-slate-900 px-0.5 font-black leading-none rounded-br z-10"
            style={{ fontSize: fontSize - 1 }}>
            ⬆{needsShift}
          </div>
        )}
        <div className="text-left mono leading-tight w-full" style={{ whiteSpace: 'pre', fontFamily: 'Consolas, "Courier New", monospace' }}>
          {/* 1줄: POL/  *POD - 공백 유지 */}
          <div className="font-bold" style={{ fontSize: fontSize - 1 }}>
            {polLabel}/{transit ? transit : '   '}<span className={ptk ? 'text-red-700 font-black' : ''}>*{podLabel}</span>
          </div>
          {/* 2줄: 컨번호 */}
          <div className="font-black" style={{ fontSize }}>
            {c.cn || ''}
          </div>
          {/* 3줄: 선사 F/E 무게 타입 */}
          <div style={{ fontSize: fontSize - 1 }}>
            {opLabel} {fe}{wtPadded} {typeLabel}
          </div>
          {/* 4줄: 특수 정보 */}
          <div className={specialColor} style={{ fontSize: fontSize - 1, minHeight: fontSize }}>
            {specialLine || '\u00A0'}
          </div>
          {/* 5줄: 위치 */}
          <div className="text-slate-600" style={{ fontSize: fontSize - 1 }}>
            {posStr}
          </div>
        </div>
      </button>
    );
  };
  
  return (
    <div className="space-y-1">
      {/* 페이지 제목 */}
      <div className="text-center font-black text-slate-800 mb-1" style={{ fontSize: fontSize + 4 }}>
        {page.title}
      </div>
      
      {/* DECK 섹션 (위쪽 5/10) */}
      <div>
        <div className="text-[10px] text-slate-500 mb-0.5 font-bold">⬆ DECK</div>
        {/* ROW 헤더 (위) */}
        <div className="flex gap-0.5 mb-0.5">
          <div style={{ width: 24 }}></div>
          {allRows.map((row, idx) => (
            <div key={`dh-${idx}`} className="text-center text-[9px] text-slate-500 mono font-bold flex-shrink-0"
              style={{ width: cellW }}>{row || ''}</div>
          ))}
          <div style={{ width: 24 }}></div>
        </div>
        {/* DECK TIER × ROW */}
        {deckTiersPadded.map((tier, ti) => (
          <div key={`dt-${ti}`} className="flex gap-0.5 mb-0.5 items-center">
            <div className="text-[9px] text-slate-500 mono font-bold flex-shrink-0 text-right pr-1" style={{ width: 24 }}>{tier || ''}</div>
            {allRows.map((row, ri) => (
              <React.Fragment key={`d-${ti}-${ri}`}>
                {renderCell(row, tier)}
              </React.Fragment>
            ))}
            <div className="text-[9px] text-slate-500 mono font-bold flex-shrink-0 pl-1" style={{ width: 24 }}>{tier || ''}</div>
          </div>
        ))}
      </div>
      
      {/* 해치커버 (굵은 검은 선) */}
      <div className="border-t-4 border-slate-900 my-2"></div>
      
      {/* HOLD 섹션 (아래쪽 5/10) */}
      <div>
        <div className="text-[10px] text-slate-500 mb-0.5 font-bold">⬇ HOLD</div>
        {holdTiersPadded.map((tier, ti) => (
          <div key={`ht-${ti}`} className="flex gap-0.5 mb-0.5 items-center">
            <div className="text-[9px] text-slate-500 mono font-bold flex-shrink-0 text-right pr-1" style={{ width: 24 }}>{tier || ''}</div>
            {allRows.map((row, ri) => (
              <React.Fragment key={`h-${ti}-${ri}`}>
                {renderCell(row, tier)}
              </React.Fragment>
            ))}
            <div className="text-[9px] text-slate-500 mono font-bold flex-shrink-0 pl-1" style={{ width: 24 }}>{tier || ''}</div>
          </div>
        ))}
        {/* ROW 헤더 (아래) */}
        <div className="flex gap-0.5 mt-0.5">
          <div style={{ width: 24 }}></div>
          {allRows.map((row, idx) => (
            <div key={`hb-${idx}`} className="text-center text-[9px] text-slate-500 mono font-bold flex-shrink-0"
              style={{ width: cellW }}>{row || ''}</div>
          ))}
          <div style={{ width: 24 }}></div>
        </div>
      </div>
    </div>
  );
}

// === 음성 헬퍼 (30일 버전 - 검증됨) ===
const KOR_DIGITS = [
  ['영','0'],['공','0'],['일','1'],['이','2'],['삼','3'],['사','4'],
  ['오','5'],['육','6'],['칠','7'],['팔','8'],['구','9'],
  ['하나','1'],['둘','2'],['셋','3'],['넷','4'],['다섯','5'],
  ['여섯','6'],['일곱','7'],['여덟','8'],['아홉','9'],['열','']
];

const parseSpokenDigits = (text) => {
  if (!text) return '';
  let s = text.toLowerCase();
  const ENG = [['zero','0'],['oh','0'],['one','1'],['two','2'],['three','3'],
               ['four','4'],['five','5'],['six','6'],['seven','7'],['eight','8'],['nine','9']];
  for (const [k, v] of ENG) s = s.split(k).join(v);
  s = s.replace(/\s+/g, '');
  // 긴 한글부터 매칭 (일곱의 일 방지)
  const sorted = [...KOR_DIGITS].sort((a,b) => b[0].length - a[0].length);
  for (const [k, v] of sorted) {
    s = s.split(k).join(v);
  }
  const matches = s.match(/\d+/g);
  if (!matches) return '';
  const allDigits = matches.join('');
  // 4자리 이상이면 끝 4자리만 (검색용)
  if (allDigits.length >= 4) return allDigits.slice(-4);
  return allDigits;
};

const NUM_KOR = ['공','일','이','삼','사','오','육','칠','팔','구'];
const charToKorean = (ch) => {
  if (/^[0-9]$/.test(ch)) return NUM_KOR[parseInt(ch, 10)];
  return ch;
};

const numberToSinoKorean = (n) => {
  if (n < 0 || n >= 100) return String(n);
  if (n === 0) return '영';
  if (n < 10) return NUM_KOR[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  let result = '';
  if (tens === 1) result = '십';
  else result = NUM_KOR[tens] + '십';
  if (ones > 0) result += NUM_KOR[ones];
  return result;
};

const tierIsAbove = (tier) => tier && tier.length === 2 && tier[0] === '8';

const speakContainer = (c, xrayOn) => {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  
  // 한 글자씩 마침표로 끊어 읽기
  const spellOut = (s) => {
    if (!s) return '';
    return s.split('').map(charToKorean).join('. ');
  };
  
  const cnSpoken = spellOut(c.cn);
  const sealSpoken = (c.sl && c.sl.trim()) ? spellOut(c.sl.trim()) : null;
  
  let sealText = '';
  if (c.fe === 'F') {
    sealText = sealSpoken ? `, 실번호. ${sealSpoken}` : ', 실번호 없음';
  } else {
    sealText = ', 엠티';
  }
  
  const xrayWarn = '';
  
  let posText = '';
  if (c.bay) {
    const bay = parseInt(c.bay, 10) || 0;
    const row = parseInt(c.row, 10) || 0;
    const deck = tierIsAbove(c.tier) ? '갑판상' : '선창내';
    posText = `, ${bay}베이 ${row}열 ${c.tier}단 ${deck}`;
  }
  
  const text = `양하 컨테이너. ${cnSpoken}${sealText}${posText}${xrayWarn}`;
  
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  u.rate = 0.95;
  window.speechSynthesis.speak(u);
};

const speakText = (text) => {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  u.rate = 1.05;
  window.speechSynthesis.speak(u);
};

// === SearchTab — 30일 버전 음성 + 4자리 버그 수정 ===
function SearchTab({ query, setQuery, results, xrayList, dischargeCns, setSelectedCn, vsl }) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [voiceSupported, setVoiceSupported] = useState(true);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const recognitionRef = useRef(null);
  const lastSpokenRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setVoiceSupported(false);
      return;
    }
    const r = new SR();
    r.lang = 'ko-KR';
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = 3;

    r.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      const text = last[0].transcript;
      setTranscript(text);
      if (last.isFinal) {
        const digits = parseSpokenDigits(text);
        if (digits && digits.length >= 2) {
          setQuery(digits);
        } else {
          speakText('숫자를 인식하지 못했습니다. 다시 말씀해주세요.');
        }
      }
    };
    r.onend = () => setIsListening(false);
    r.onerror = (e) => {
      setIsListening(false);
      if (e.error === 'not-allowed') {
        speakText('마이크 권한이 필요합니다.');
      }
    };
    recognitionRef.current = r;
    return () => { try { r.abort(); } catch(_) {} };
  }, []);

  // 검색 결과 자동 음성 안내 (30일 버전)
  useEffect(() => {
    if (!autoSpeak) return;
    if (!query || query.length < 2) return;
    const sig = `${query}-${results.length}-${results[0]?.cn || 'none'}`;
    if (lastSpokenRef.current === sig) return;
    lastSpokenRef.current = sig;

    if (results.length === 0) {
      const queryDigits = query.replace(/\D/g, '');
      if (queryDigits.length >= 2) {
        const spokenQuery = queryDigits.split('').map(charToKorean).join('. ');
        speakText(`${spokenQuery}, 일치하는 컨테이너가 없습니다. 다시 말씀해 주세요.`);
      } else {
        speakText('일치하는 컨테이너가 없습니다. 다시 말씀해 주세요.');
      }
      return;
    }

    if (results.length === 1) {
      speakContainer(results[0], !!xrayList[results[0].cn]);
    } else if (results.length > 1 && results.length <= 5) {
      const countKor = numberToSinoKorean(results.length);
      const cnSpoken = results[0].cn.split('').map(charToKorean).join('. ');
      speakText(`${countKor} 개의 컨테이너가 일치합니다. 첫 번째 결과. ${cnSpoken}`);
    } else if (results.length > 5) {
      const countKor = numberToSinoKorean(results.length);
      speakText(`${countKor} 개의 컨테이너가 일치합니다. 더 자세한 번호를 말씀해주세요.`);
    }
  }, [results, query, autoSpeak, xrayList]);

  const startListening = () => {
    if (!recognitionRef.current) return;
    setTranscript('');
    setIsListening(true);
    try {
      recognitionRef.current.start();
    } catch (e) {
      setIsListening(false);
    }
  };

  const stopListening = () => {
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.stop();
    } catch (e) {}
    setIsListening(false);
  };

  return (
    <div className="space-y-3">
      {/* 선박 추적 */}
      {vsl && <VesselTracker vsl={vsl}/>}
      
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500"/>
          <input type="text" value={query} 
            onChange={e => setQuery(e.target.value)}
            placeholder="컨테이너 / 끝 4자리 / 실 / B/L"
            className="w-full pl-9 pr-24 py-2.5 bg-slate-800 border border-slate-700 rounded text-sm mono"/>
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {voiceSupported && (
              <button onClick={isListening ? stopListening : startListening}
                className={`w-9 h-9 rounded flex items-center justify-center transition ${
                  isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-amber-500 hover:bg-amber-400 text-slate-900'
                }`} title="음성 검색">
                {isListening ? <MicOff className="w-4 h-4"/> : <Mic className="w-4 h-4"/>}
              </button>
            )}
            <button onClick={() => setAutoSpeak(!autoSpeak)}
              className={`w-7 h-9 rounded flex items-center justify-center ${
                autoSpeak ? 'text-amber-300' : 'text-slate-500'
              }`} title={autoSpeak ? '음성 안내 끄기' : '음성 안내 켜기'}>
              {autoSpeak ? <Volume2 className="w-4 h-4"/> : <VolumeX className="w-4 h-4"/>}
            </button>
            {query && (
              <button onClick={() => setQuery('')} className="w-7 h-9 rounded hover:bg-slate-700 flex items-center justify-center">
                <X className="w-4 h-4"/>
              </button>
            )}
          </div>
        </div>
        {isListening && transcript && (
          <div className="mt-1.5 text-[10px] text-red-300 mono bg-red-900/20 px-2 py-1 rounded">
            🎙 {transcript}
          </div>
        )}
        <div className="text-[10px] text-slate-500 mt-1.5">
          {query.length < 2 ? '🎤 마이크 누르고 "공구일오" 식으로 또박또박. 4자리 = 끝자리 매칭' : `${results.length}개 결과`}
        </div>
      </div>
      
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden divide-y divide-slate-800">
        {results.map((c, i) => {
          // dischargeCns 안전 체크 (4자리 입력 시 튕김 방지)
          const isPtk = dischargeCns && typeof dischargeCns.has === 'function' && dischargeCns.has(c.cn);
          return (
            <div key={(c.cn || '_') + i} onClick={() => setSelectedCn(c.cn)}
              className={`px-3 py-2.5 cursor-pointer hover:bg-slate-800/50 ${isPtk ? 'bg-red-950/20' : ''}`}>
              <div className="flex items-center gap-2 flex-wrap">
                {isPtk && <span className="text-red-300 text-xs font-bold">[양하]</span>}
                <span className="mono font-black text-sm">{c.cn || ''}</span>
                <span className={`text-[10px] mono px-1.5 py-0.5 rounded font-bold ${c.fe === 'F' ? 'bg-emerald-900 text-emerald-300' : 'bg-slate-700 text-slate-300'}`}>{c.fe || 'F'}</span>
                {c.dg && <span className="text-red-400">🔥</span>}
                {c.rf && <span className="text-cyan-400">❄</span>}
                {c.tk && <span className="text-orange-400">⬛</span>}
              </div>
              <div className="text-[11px] text-slate-400 mono mt-0.5">
                {c.bay && `${fmtPos(c)} · `}{isoToLabel(c.iso)}
                {c.pol && ` · POL ${c.pol}`}{c.sl && ` · 실 ${c.sl}`}
              </div>
            </div>
          );
        })}
        {query.length >= 2 && results.length === 0 && (
          <div className="p-8 text-center text-slate-500 text-sm">결과 없음</div>
        )}
      </div>
    </div>
  );
}

function VesselTracker({ vsl }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!vsl) return null;

  const q = encodeURIComponent(vsl);
  const sites = [
    { name: 'MarineTraffic', url: `https://www.marinetraffic.com/en/ais/index/search/all/keyword:${q}` },
    { name: 'VesselFinder', url: `https://www.vesselfinder.com/vessels?name=${q}` },
    { name: 'MyShipTracking', url: `https://www.myshiptracking.com/?search=${q}` },
    { name: 'ShipFinder', url: `https://www.shipfinder.co/?q=${q}` },
  ];

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)}
        className="w-full bg-blue-900/30 border border-blue-700/40 hover:bg-blue-900/50 rounded-lg px-3 py-2 flex items-center gap-2 text-sm">
        <Ship className="w-4 h-4 text-blue-300"/>
        <span className="text-blue-200 font-bold flex-1 text-left">선박 위치 추적: {vsl}</span>
        <ChevronRight className={`w-4 h-4 text-blue-400 transition ${open ? 'rotate-90' : ''}`}/>
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl z-30 p-2 space-y-1">
          {sites.map(s => (
            <a key={s.name} href={s.url} target="_blank" rel="noopener noreferrer"
              className="block px-3 py-2 hover:bg-slate-800 rounded text-sm text-blue-300 hover:text-blue-200">
              🌐 {s.name} 에서 검색
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// === 항차 통계 박스 (검증 + 종류별 갯수) ===
function VoyageStatsBox({ voyage }) {
  const containers = voyage.ediContainers || [];
  const records = voyage.dischargeRecords || [];
  const sources = voyage.sources || [];
  
  // EDI/ASC 비교 결과
  const comparison = useMemo(() => {
    const result = {
      hasEdi: sources.includes('EDI'),
      hasAsc: sources.includes('ASC'),
      onlyEdi: 0, // EDI 만 있는 컨
      onlyAsc: 0, // ASC 만 있는 컨
      both: 0,    // 둘 다 있는 컨
      diff: [],   // 정보 다른 컨
    };
    if (!result.hasEdi || !result.hasAsc) return result;
    for (const c of containers) {
      const cs = c._sources || [c._source];
      if (cs.includes('EDI') && cs.includes('ASC')) result.both++;
      else if (cs.includes('EDI')) result.onlyEdi++;
      else if (cs.includes('ASC')) result.onlyAsc++;
    }
    return result;
  }, [containers, sources]);
  
  // 양하리스트 ↔ EDI/ASC 비교 (선사별)
  // 양방향 체크: 리스트 컨이 EDI 에 없거나, EDI 의 양하 대상이 리스트에 없거나
  const listValidation = useMemo(() => {
    if (records.length === 0) return null;
    
    const ediCns = new Set(containers.map(c => c.cn));
    const listCns = new Set(records.map(r => r.cn));
    
    // 리스트의 컨이 EDI 에 없는 경우 (선사별 ASC 필요)
    const missingInEdi = [];
    const missingByCarrier = {};
    for (const r of records) {
      if (!ediCns.has(r.cn)) {
        missingInEdi.push(r);
        const carrier = r.op || r.carrier || 'UNKNOWN';
        missingByCarrier[carrier] = (missingByCarrier[carrier] || 0) + 1;
      }
    }
    
    // EDI 의 양하/선적 대상이 리스트에 없는 경우 (리스트 누락)
    // 양하: POD = PTK / 선적: POL = PTK
    const isPtk = (c) => {
      const pod = (c.pod || '').toUpperCase();
      const pol = (c.pol || '').toUpperCase();
      return pod.endsWith('PTK') || pol.endsWith('PTK');
    };
    const ptkInEdi = containers.filter(isPtk);
    const ptkMissingInList = ptkInEdi.filter(c => !listCns.has(c.cn));
    
    return {
      total: records.length,
      ediTotal: containers.length,
      ptkInEdi: ptkInEdi.length,
      matched: records.filter(r => ediCns.has(r.cn)).length,
      missingInEdi: missingInEdi.length,
      missingByCarrier,
      ptkMissingInList: ptkMissingInList.length,
      ptkMissingDetails: ptkMissingInList.slice(0, 10),
    };
  }, [containers, records]);
  
  // 화물 종류별 통계
  const stats = useMemo(() => {
    const s = {
      total: containers.length,
      dc20F: 0, dc20E: 0, dc40F: 0, dc40E: 0, hc40F: 0, hc40E: 0,
      rf20F: 0, rf40F: 0,  // 온도 있는 Full 리퍼만
      tk20: 0, tk40: 0, fr20: 0, fr40: 0, ot20: 0, ot40: 0,
      dg: 0, fr: 0, oog: 0,
      f: 0, e: 0, other: 0,
    };
    for (const c of containers) {
      if (c.fe === 'F') s.f++;
      else s.e++;
      
      if (c.dg) s.dg++;
      if (c.fr) s.fr++;
      if (c.oog) s.oog++;
      
      const lbl = isoToLabel(c.iso);
      const isF = c.fe === 'F';
      const hasTmp = c.tmp && String(c.tmp).trim() !== '' && String(c.tmp).trim() !== '0';
      
      // 리퍼 처리:
      // 1) 리퍼 + Full + 온도 있음 → RF 합산 (진짜 리퍼 운영)
      // 2) 리퍼 + Empty 또는 온도 없음 → 일반 DC/HC 로 합산
      if (lbl === '20RF') {
        if (isF && hasTmp) {
          s.rf20F++;
        } else {
          // Empty 리퍼 또는 온도 없는 리퍼 → 20DC 로 카운트
          if (isF) s.dc20F++; else s.dc20E++;
        }
      } else if (lbl === '40RF') {
        if (isF && hasTmp) {
          s.rf40F++;
        } else {
          // Empty 리퍼 또는 온도 없는 리퍼 → 40HC 로 카운트 (40 리퍼는 보통 HC)
          if (isF) s.hc40F++; else s.hc40E++;
        }
      }
      else if (lbl === '20DC') { if (isF) s.dc20F++; else s.dc20E++; }
      else if (lbl === '40DC') { if (isF) s.dc40F++; else s.dc40E++; }
      else if (lbl === '40HC') { if (isF) s.hc40F++; else s.hc40E++; }
      else if (lbl === '20TK') s.tk20++;
      else if (lbl === '40TK') s.tk40++;
      else if (lbl === '20FR') s.fr20++;
      else if (lbl === '40FR') s.fr40++;
      else if (lbl === '20OT') s.ot20++;
      else if (lbl === '40OT') s.ot40++;
      else s.other++;
    }
    return s;
  }, [containers]);
  
  // 표시할 게 없으면 숨김
  if (containers.length === 0 && records.length === 0) return null;
  
  return (
    <div className="space-y-2">
      {/* EDI/ASC 비교 */}
      {comparison.hasEdi && comparison.hasAsc && (
        <div className={`rounded-lg p-3 border ${comparison.onlyEdi === 0 && comparison.onlyAsc === 0 ? 'bg-emerald-900/30 border-emerald-700' : 'bg-orange-900/30 border-orange-700'}`}>
          <div className="text-xs font-bold mb-1 flex items-center gap-2">
            {comparison.onlyEdi === 0 && comparison.onlyAsc === 0 
              ? <span className="text-emerald-300">✅ EDI ↔ ASC 일치</span>
              : <span className="text-orange-300">⚠ EDI ↔ ASC 차이 발견</span>}
          </div>
          <div className="text-[11px] mono space-y-0.5">
            <div>둘 다: <span className="text-emerald-300 font-bold">{comparison.both}</span>대</div>
            {comparison.onlyEdi > 0 && <div>EDI 만: <span className="text-orange-300 font-bold">{comparison.onlyEdi}</span>대 (ASC 빠짐)</div>}
            {comparison.onlyAsc > 0 && <div>ASC 만: <span className="text-orange-300 font-bold">{comparison.onlyAsc}</span>대 (EDI 빠짐)</div>}
          </div>
        </div>
      )}
      
      {/* 양하리스트 검증 */}
      {listValidation && (
        <div className={`rounded-lg p-3 border ${listValidation.missingInEdi === 0 && listValidation.ptkMissingInList === 0 ? 'bg-emerald-900/30 border-emerald-700' : 'bg-red-900/30 border-red-700'}`}>
          <div className="text-xs font-bold mb-1">
            {listValidation.missingInEdi === 0 && listValidation.ptkMissingInList === 0
              ? <span className="text-emerald-300">✅ 리스트 ↔ EDI/ASC 일치 ({listValidation.matched}대)</span>
              : <span className="text-red-300">⚠ {listValidation.missingInEdi + listValidation.ptkMissingInList}대 차이 발견</span>}
          </div>
          
          <div className="text-[11px] mono space-y-0.5">
            <div className="text-slate-300">
              EDI/ASC: <span className="font-bold text-blue-300">{listValidation.ediTotal}</span>대 · 
              리스트: <span className="font-bold text-amber-300">{listValidation.total}</span>대 · 
              매칭: <span className="font-bold text-emerald-300">{listValidation.matched}</span>대
            </div>
            
            {listValidation.missingInEdi > 0 && (
              <div className="mt-2 pt-2 border-t border-red-800">
                <div className="text-red-300 font-bold">📋 리스트에 있는데 EDI/ASC 에 없음: {listValidation.missingInEdi}대</div>
                {Object.entries(listValidation.missingByCarrier).map(([c, n]) => (
                  <div key={c} className="text-orange-200 ml-2">• {c}: {n}대 (해당 선사 ASC 추가 필요)</div>
                ))}
              </div>
            )}
            
            {listValidation.ptkMissingInList > 0 && (
              <div className="mt-2 pt-2 border-t border-red-800">
                <div className="text-red-300 font-bold">🚢 EDI/ASC 에 평택 대상 있는데 리스트에 없음: {listValidation.ptkMissingInList}대</div>
                {listValidation.ptkMissingDetails.map((c, i) => (
                  <div key={i} className="text-orange-200 ml-2 text-[10px]">• {c.cn} ({c.op || '?'}) {c.bay ? `${c.bay}-${c.row}-${c.tier}` : ''}</div>
                ))}
                {listValidation.ptkMissingInList > 10 && <div className="text-[10px] text-red-300/70 ml-2">... 외 {listValidation.ptkMissingInList - 10}대</div>}
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* 종류별 통계 */}
      {containers.length > 0 && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
          <div className="text-xs font-bold text-blue-200 mb-2">📊 화물 종류별 통계 (전체 {stats.total}대 = F {stats.f} / E {stats.e})</div>
          
          {/* 일반 컨테이너 (F/E) */}
          <div className="grid grid-cols-3 gap-1.5 mb-2">
            <div className="bg-slate-800 rounded p-1.5 text-center">
              <div className="text-[10px] text-slate-400">20DC F/E</div>
              <div className="text-sm font-bold mono">
                <span className="text-emerald-300">{stats.dc20F}</span>
                <span className="text-slate-500 text-[10px]"> / </span>
                <span className="text-slate-400">{stats.dc20E}</span>
              </div>
              <div className="text-[9px] text-slate-500 mono">합 {stats.dc20F + stats.dc20E}</div>
            </div>
            <div className="bg-slate-800 rounded p-1.5 text-center">
              <div className="text-[10px] text-slate-400">40DC F/E</div>
              <div className="text-sm font-bold mono">
                <span className="text-emerald-300">{stats.dc40F}</span>
                <span className="text-slate-500 text-[10px]"> / </span>
                <span className="text-slate-400">{stats.dc40E}</span>
              </div>
              <div className="text-[9px] text-slate-500 mono">합 {stats.dc40F + stats.dc40E}</div>
            </div>
            <div className="bg-slate-800 rounded p-1.5 text-center">
              <div className="text-[10px] text-slate-400">40HC F/E</div>
              <div className="text-sm font-bold mono">
                <span className="text-emerald-300">{stats.hc40F}</span>
                <span className="text-slate-500 text-[10px]"> / </span>
                <span className="text-slate-400">{stats.hc40E}</span>
              </div>
              <div className="text-[9px] text-slate-500 mono">합 {stats.hc40F + stats.hc40E}</div>
            </div>
          </div>
          
          {/* 리퍼 (온도 있는 Full 만) */}
          {(stats.rf20F + stats.rf40F) > 0 && (
            <div className="grid grid-cols-2 gap-1.5 mb-2">
              {stats.rf20F > 0 && (
                <div className="bg-cyan-900/40 border border-cyan-700/40 rounded p-1.5 text-center">
                  <div className="text-[10px] text-cyan-300">❄ 20RF (운영)</div>
                  <div className="text-sm font-bold mono text-cyan-200">{stats.rf20F}</div>
                </div>
              )}
              {stats.rf40F > 0 && (
                <div className="bg-cyan-900/40 border border-cyan-700/40 rounded p-1.5 text-center">
                  <div className="text-[10px] text-cyan-300">❄ 40RF (운영)</div>
                  <div className="text-sm font-bold mono text-cyan-200">{stats.rf40F}</div>
                </div>
              )}
            </div>
          )}
          
          {/* 특수 (TK, FR, OT) */}
          <div className="grid grid-cols-6 gap-1">
            {stats.tk20 > 0 && <div className="bg-orange-900/50 border border-orange-700/50 rounded p-1.5 text-center">
              <div className="text-[10px] text-orange-300">⬛ 20TK</div>
              <div className="text-sm font-bold mono text-orange-200">{stats.tk20}</div>
            </div>}
            {stats.tk40 > 0 && <div className="bg-orange-900/50 border border-orange-700/50 rounded p-1.5 text-center">
              <div className="text-[10px] text-orange-300">⬛ 40TK</div>
              <div className="text-sm font-bold mono text-orange-200">{stats.tk40}</div>
            </div>}
            {stats.fr20 > 0 && <div className="bg-purple-900/50 border border-purple-700/50 rounded p-1.5 text-center">
              <div className="text-[10px] text-purple-300">🔲 20FR</div>
              <div className="text-sm font-bold mono text-purple-200">{stats.fr20}</div>
            </div>}
            {stats.fr40 > 0 && <div className="bg-purple-900/50 border border-purple-700/50 rounded p-1.5 text-center">
              <div className="text-[10px] text-purple-300">🔲 40FR</div>
              <div className="text-sm font-bold mono text-purple-200">{stats.fr40}</div>
            </div>}
            {stats.ot20 > 0 && <div className="bg-pink-900/50 border border-pink-700/50 rounded p-1.5 text-center">
              <div className="text-[10px] text-pink-300">📐 20OT</div>
              <div className="text-sm font-bold mono text-pink-200">{stats.ot20}</div>
            </div>}
            {stats.ot40 > 0 && <div className="bg-pink-900/50 border border-pink-700/50 rounded p-1.5 text-center">
              <div className="text-[10px] text-pink-300">📐 40OT</div>
              <div className="text-sm font-bold mono text-pink-200">{stats.ot40}</div>
            </div>}
            {stats.dg > 0 && <div className="bg-red-900/50 border border-red-700/50 rounded p-1.5 text-center">
              <div className="text-[10px] text-red-300">🔥 DG</div>
              <div className="text-sm font-bold mono text-red-200">{stats.dg}</div>
            </div>}
            {stats.other > 0 && <div className="bg-slate-700 rounded p-1.5 text-center">
              <div className="text-[10px] text-slate-300">기타</div>
              <div className="text-sm font-bold mono text-slate-200">{stats.other}</div>
            </div>}
          </div>
          
          {sources.length > 0 && (
            <div className="text-[10px] text-slate-500 mt-2">자료 소스: {sources.join(' + ')}</div>
          )}
        </div>
      )}
    </div>
  );
}

function VoyageTab({ voyages, activeKey, setActiveKey, addVoyage, deleteVoyage, applyDischargeList, addXrayBulk }) {
  const [ediStatus, setEdiStatus] = useState(null);
  const [dischargeStatus, setDischargeStatus] = useState(null);
  const [xrayStatus, setXrayStatus] = useState(null);
  const ediRef = useRef(null); const dischargeRef = useRef(null); const xrayRef = useRef(null);
  
  const handleEdi = async (filesOrFile) => {
    const files = filesOrFile instanceof FileList 
      ? Array.from(filesOrFile)
      : (filesOrFile ? [filesOrFile] : []);
    if (files.length === 0) return;
    
    setEdiStatus({ loading: true, msg: `${files.length}개 파일 처리 중...` });
    
    const results = [];
    
    // 1단계: 모든 파일 파싱해서 항차별로 누적
    const voyageGroups = {}; // key: voyageKey
    
    for (let idx = 0; idx < files.length; idx++) {
      const file = files[idx];
      try {
        setEdiStatus({ loading: true, msg: `[${idx + 1}/${files.length}] ${file.name} 파싱 중...` });
        const text = await file.text();
        let r;
        let fileType = 'EDI';
        if (text.startsWith('$604') || text.substring(0, 200).includes('$604')) {
          r = parseAscFile(text);
          fileType = 'ASC';
        } else {
          r = parseBAPLIE(text);
        }
        if (r.containers.length === 0) {
          results.push(`❌ ${file.name}: 컨테이너 없음`);
          continue;
        }
        const vsl = r.vsl || file.name.replace(/\.[^.]+$/, '');
        const voy = r.voy || '0000';
        const groupKey = `${vsl}|${voy}`;
        
        if (!voyageGroups[groupKey]) {
          voyageGroups[groupKey] = {
            vsl, voy, etd: r.etd || '', pol: r.pol || '',
            allContainers: [],
            sources: [],
          };
        }
        voyageGroups[groupKey].allContainers.push(...r.containers);
        if (!voyageGroups[groupKey].sources.includes(fileType)) {
          voyageGroups[groupKey].sources.push(fileType);
        }
        results.push(`✅ [${fileType}] ${vsl} ${voy}: +${r.containers.length}대`);
      } catch (e) {
        results.push(`❌ ${file.name}: ${e.message}`);
      }
    }
    
    // 2단계: 항차별로 한 번씩만 addVoyage 호출 (누적은 addVoyage 안에서)
    let totalAdded = 0;
    for (const [groupKey, group] of Object.entries(voyageGroups)) {
      try {
        // 그룹 안에서 중복 컨번호는 미리 dedupe
        const cnMap = {};
        for (const c of group.allContainers) cnMap[c.cn] = { ...cnMap[c.cn], ...c };
        const dedup = Object.values(cnMap);
        
        // 각 source 별로 한 번씩 호출하면 그게 합쳐짐
        for (const src of group.sources) {
          const result = await addVoyage(group.vsl, group.voy, dedup, group.etd, group.pol, src);
          if (result) totalAdded = result.total;
        }
      } catch (e) {
        results.push(`❌ ${group.vsl} ${group.voy}: ${e.message}`);
      }
    }
    
    setEdiStatus({ 
      ok: true, 
      msg: `${files.length}개 파일 완료 (총 ${totalAdded}대)\n${results.join('\n')}`
    });
    
    if (ediRef.current) ediRef.current.value = '';
  };
  
  const handleDischarge = async (filesOrFile) => {
    if (!activeKey) return;
    const files = filesOrFile instanceof FileList 
      ? Array.from(filesOrFile)
      : (filesOrFile ? [filesOrFile] : []);
    if (files.length === 0) return;
    
    setDischargeStatus({ loading: true, msg: `${files.length}개 파일 처리 중...` });
    
    const results = [];
    
    // 1단계: 메모리에서 모든 파일 누적 (Firebase 한 번만 저장)
    const existing = voyages[activeKey];
    const existingRecords = existing?.dischargeRecords || [];
    const cnMap = {};
    for (const r of existingRecords) cnMap[r.cn] = r;
    
    for (let idx = 0; idx < files.length; idx++) {
      const file = files[idx];
      try {
        setDischargeStatus({ loading: true, msg: `[${idx + 1}/${files.length}] ${file.name} 파싱 중...` });
        const buf = await file.arrayBuffer();
        const { records } = await parseListExcel(buf);
        if (records.length === 0) {
          results.push(`❌ ${file.name}: 데이터 없음`);
          continue;
        }
        // 메모리에 누적 (state 의존 X)
        let added = 0;
        for (const r of records) {
          if (!cnMap[r.cn]) added++;
          cnMap[r.cn] = { ...cnMap[r.cn], ...r };
        }
        results.push(`✅ ${file.name}: +${records.length}대 (신규 ${added})`);
      } catch (e) {
        results.push(`❌ ${file.name}: ${e.message}`);
      }
    }
    
    // 2단계: 한 번에 저장
    try {
      const result = await applyDischargeList(activeKey, Object.values(cnMap), true);
      const merged = Object.values(cnMap);
      setDischargeStatus({ 
        ok: true, 
        msg: `${files.length}개 파일 완료 (전체 ${merged.length}대)\n${results.join('\n')}`
      });
    } catch (e) {
      setDischargeStatus({ ok: false, msg: `저장 실패: ${e.message}` });
    }
    
    if (dischargeRef.current) dischargeRef.current.value = '';
  };
  
  const handleXray = async (filesOrFile) => {
    if (!activeKey) return;
    const files = filesOrFile instanceof FileList 
      ? Array.from(filesOrFile)
      : (filesOrFile ? [filesOrFile] : []);
    if (files.length === 0) return;
    
    setXrayStatus({ loading: true, msg: `${files.length}개 파일 처리 중...` });
    let total = 0;
    for (const file of files) {
      try {
        const buf = await file.arrayBuffer();
        const { containers } = await parseXrayList(buf);
        await addXrayBulk(containers);
        total += containers.length;
      } catch (e) {}
    }
    setXrayStatus({ ok: true, msg: `${files.length}개 파일 완료 (총 ${total}개 X-RAY 등록)` });
    if (xrayRef.current) xrayRef.current.value = '';
  };
  
  return <div className="space-y-4">
    <div className="bg-blue-900/20 border border-blue-700/40 rounded-lg p-3 flex items-start gap-2">
      <Cloud className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5"/>
      <div className="text-xs text-blue-200/80">
        ☁ Firebase 실시간 동기화. 같은 선박/항차로 여러 ASC/EDI/리스트 올리면 <b>자동 합산</b>됩니다.
      </div>
    </div>
    
    {/* 활성 항차 통계 + 검증 */}
    {activeKey && voyages[activeKey] && <VoyageStatsBox voyage={voyages[activeKey]}/>}
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-2">
      <div className="font-bold text-blue-200 text-sm">1. 양하 자료 (ASC / EDI / TXT) — 여러 개 동시 선택</div>
      <input ref={ediRef} type="file" multiple accept="*/*" onChange={e => handleEdi(e.target.files)} style={{ display: 'none' }}/>
      <button onClick={() => ediRef.current?.click()}
        className="w-full py-3 px-4 bg-blue-500 hover:bg-blue-400 active:bg-blue-600 text-slate-900 rounded-lg font-bold text-sm flex items-center justify-center gap-2">
        <Upload className="w-5 h-5"/>
        파일 선택 (여러 개 가능)
      </button>
      {ediStatus && <div className={`text-xs px-2 py-1.5 rounded mono whitespace-pre-line ${ediStatus.ok ? 'bg-emerald-900/40 text-emerald-200' : ediStatus.loading ? 'bg-slate-800 text-slate-300' : 'bg-red-900/40 text-red-200'}`}>{ediStatus.msg}</div>}
    </div>
    {activeKey && <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-2">
      <div className="font-bold text-amber-200 text-sm">2. 양하 리스트 (Excel) — 여러 개 동시 선택</div>
      <input ref={dischargeRef} type="file" multiple accept="*/*" onChange={e => handleDischarge(e.target.files)} style={{ display: 'none' }}/>
      <button onClick={() => dischargeRef.current?.click()}
        className="w-full py-3 px-4 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-900 rounded-lg font-bold text-sm flex items-center justify-center gap-2">
        <Upload className="w-5 h-5"/>
        파일 선택 (Excel / CSV)
      </button>
      {dischargeStatus && <div className={`text-xs px-2 py-1.5 rounded mono whitespace-pre-line ${dischargeStatus.ok ? 'bg-emerald-900/40 text-emerald-200' : dischargeStatus.loading ? 'bg-slate-800 text-slate-300' : 'bg-red-900/40 text-red-200'}`}>{dischargeStatus.msg}</div>}
    </div>}
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <div className="font-bold text-sm mb-3">항차 목록 ({Object.keys(voyages).length}개) <span className="text-[10px] text-emerald-400">☁ Firebase</span></div>
      {Object.keys(voyages).length === 0 ? <div className="text-center text-slate-500 text-sm py-6">등록된 항차 없음</div> : <div className="space-y-1.5">{Object.values(voyages).map(v => <div key={v.key || v.vsl + v.voy} className={`p-2.5 rounded border flex items-center gap-2 ${(v.key || makeVoyageKey(v.vsl, v.voy, 'discharge')) === activeKey ? 'bg-amber-900/20 border-amber-600' : 'bg-slate-800/40 border-slate-700'}`}>
        <button onClick={() => setActiveKey(v.key || makeVoyageKey(v.vsl, v.voy, 'discharge'))} className="flex-1 text-left">
          <div className="font-bold text-sm">{v.vsl} <span className="mono text-amber-300">{v.voy}</span></div>
          <div className="text-[10px] text-slate-400 mono">EDI {v.ediContainers?.length || 0} · 양하 {v.dischargeRecords?.length || 0}</div>
        </button>
        <button onClick={() => deleteVoyage(v.key || makeVoyageKey(v.vsl, v.voy, 'discharge'))} className="w-8 h-8 bg-red-900/40 hover:bg-red-900/60 rounded text-red-300 flex items-center justify-center"><Trash2 className="w-4 h-4"/></button>
      </div>)}</div>}
    </div>
  </div>;
}

function DetailModal({ c, isDischarge, xrayMarked, toggleXray, completed, completedInfo, onComplete, onCancelComplete, xraySeal, onSetXraySeal, onClose }) {
  const [seal, setSeal] = useState(xraySeal.seal || '');
  const [eseal, setEseal] = useState(xraySeal.eseal || '');
  return <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 overflow-y-auto" onClick={onClose}>
    <div className="bg-slate-900 border border-slate-700 rounded-lg max-w-md w-full p-4 space-y-3 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {isDischarge && <div className="text-[10px] text-red-300 font-bold mb-0.5">[평택 양하]</div>}
          <div className="mono font-black text-xl text-amber-200">{c.cn}</div>
          <div className="text-xs text-slate-400 mt-1">{c.bay && <>{fmtPos(c)} · </>}{isoToLabel(c.iso)} · {c.fe || 'F'}{c.wt > 0 && <> · {formatWt(c.wt)}</>}</div>
        </div>
        <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center"><X className="w-4 h-4"/></button>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs bg-slate-800/50 rounded p-2.5">
        {c.pol && <div><span className="text-slate-400">POL:</span> <span className="mono font-bold">{c.pol}</span></div>}
        {c.pod && <div><span className="text-slate-400">POD:</span> <span className="mono font-bold">{c.pod}</span></div>}
        {c.sl && <div className="col-span-2"><span className="text-slate-400">실:</span> <span className="mono font-bold text-amber-200">{c.sl}</span></div>}
        {c.bl && <div className="col-span-2"><span className="text-slate-400">B/L:</span> <span className="mono">{c.bl}</span></div>}
        {c.op && <div><span className="text-slate-400">선사:</span> {c.op}</div>}
        {c.tmp && <div><span className="text-slate-400">온도:</span> <span className="text-cyan-300 font-bold">{c.tmp}°C</span></div>}
      </div>
      {(c.dg || c.rf || c.tk || c.oog) && <div className="flex flex-wrap gap-1 text-xs">
        {c.dg && <span className="bg-red-900/60 text-red-200 px-2 py-1 rounded font-bold">🔥 DG {c.un && `UN${c.un}`}</span>}
        {c.rf && (c.tmp && String(c.tmp).trim() !== '' && String(c.tmp).trim() !== '0' && c.fe === 'F'
          ? <span className="bg-cyan-900/60 text-cyan-200 px-2 py-1 rounded font-bold">❄ REEFER {c.tmp}°C</span>
          : <span className="bg-cyan-900/30 text-cyan-300 px-2 py-1 rounded font-bold border border-cyan-700/50">RE (Empty)</span>
        )}
        {c.tk && <span className="bg-orange-900/60 text-orange-200 px-2 py-1 rounded font-bold">⬛ TANK</span>}
        {c.oog && <span className="bg-purple-900/60 text-purple-200 px-2 py-1 rounded font-bold">📐 OOG</span>}
      </div>}
      <div className="space-y-2">
        
        {xrayMarked && <div className="bg-amber-900/20 border border-amber-700/40 rounded p-2.5 space-y-2">
          <div className="text-[10px] text-amber-200 font-bold">실 / E-SEAL</div>
          <input value={seal} onChange={e => setSeal(e.target.value)} onBlur={() => onSetXraySeal(seal, eseal)} placeholder="실 번호" className="w-full px-2 py-1.5 bg-slate-800 rounded text-xs mono"/>
          <input value={eseal} onChange={e => setEseal(e.target.value)} onBlur={() => onSetXraySeal(seal, eseal)} placeholder="E-SEAL 4자리" className="w-full px-2 py-1.5 bg-slate-800 rounded text-xs mono"/>
        </div>}
      </div>
      {!completed ? <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-700">
        <button onClick={() => onComplete(false)} className="px-4 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-900 rounded font-bold text-sm flex items-center justify-center gap-1.5"><Check className="w-5 h-5"/>정상 완료</button>
        <button onClick={() => onComplete(true)} className="px-4 py-3 bg-orange-500 hover:bg-orange-400 text-slate-900 rounded font-bold text-sm">⚠ 데미지</button>
      </div> : <div className={`pt-2 border-t border-slate-700 rounded p-3 ${completedInfo?.damaged ? 'bg-orange-900/30' : 'bg-emerald-900/30'}`}>
        <div className="flex items-center justify-between">
          <div className={`text-xs font-bold ${completedInfo?.damaged ? 'text-orange-200' : 'text-emerald-200'}`}>{completedInfo?.damaged ? '⚠ 데미지' : '✓ 검수 완료'}{completedInfo?.by && <span className="ml-2 text-slate-300">[{completedInfo.by}]</span>}</div>
          <button onClick={onCancelComplete} className="text-xs px-3 py-1.5 bg-red-900/40 hover:bg-red-800/50 text-red-200 rounded">완료 취소</button>
        </div>
        {completedInfo?.at && <div className="text-[10px] text-slate-400 mono mt-1">{new Date(completedInfo.at).toLocaleString('ko-KR')}</div>}
      </div>}
    </div>
  </div>;
}
