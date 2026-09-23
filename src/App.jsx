import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Container, Form, Modal, Row, Spinner } from 'react-bootstrap';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/ko';

dayjs.extend(relativeTime);
dayjs.locale('ko');

const API_URL = 'http://localhost:8080/api/v1/station/';
const EMPTY_FORM = { stationName: '', subwayLine: '', location: '' };
const INITIALS = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const MEDIALS = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const FINALS = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const FINAL_PARTS = { 'ㄳ': ['ㄱ', 'ㅅ'], 'ㄵ': ['ㄴ', 'ㅈ'], 'ㄶ': ['ㄴ', 'ㅎ'], 'ㄺ': ['ㄹ', 'ㄱ'], 'ㄻ': ['ㄹ', 'ㅁ'], 'ㄼ': ['ㄹ', 'ㅂ'], 'ㄽ': ['ㄹ', 'ㅅ'], 'ㄾ': ['ㄹ', 'ㅌ'], 'ㄿ': ['ㄹ', 'ㅍ'], 'ㅀ': ['ㄹ', 'ㅎ'], 'ㅄ': ['ㅂ', 'ㅅ'] };
const INITIAL_SET = new Set(INITIALS);

async function request(url, options) {
  let response;
  try { response = await fetch(url, options); }
  catch { throw new Error('서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인하세요.'); }
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.text()).trim(); } catch { /* use status text */ }
    throw new Error(detail || `요청에 실패했습니다. (HTTP ${response.status})`);
  }
  if (response.status === 204 || options?.method === 'DELETE') return null;
  return response.json();
}

function normalizeForSearch(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('ko-KR');
}

function decomposeHangul(text) {
  return Array.from(text, (char) => {
    const code = char.codePointAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      const offset = code - 0xac00;
      return { initial: INITIALS[Math.floor(offset / 588)], medial: MEDIALS[Math.floor((offset % 588) / 28)], final: FINALS[offset % 28], raw: char };
    }
    if (code >= 0x1100 && code <= 0x1112) return { initial: INITIALS[code - 0x1100], raw: char };
    return { raw: char };
  });
}

function getInitialSequence(text) {
  return decomposeHangul(text).map((part) => part.initial ?? part.raw).join('');
}

function jamoSequence(text) {
  return decomposeHangul(normalizeForSearch(text)).flatMap((part) => {
    if (!part.initial) return Array.from(part.raw);
    return [part.initial, part.medial, ...(FINAL_PARTS[part.final] ?? (part.final ? [part.final] : []))];
  }).join('');
}

function matchesHangulPart(target, query) {
  const haystack = decomposeHangul(target);
  const needle = decomposeHangul(query);
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    let matched = true;
    for (let index = 0; index < needle.length; index += 1) {
      const wanted = needle[index];
      const actual = haystack[start + index];
      if (wanted.initial && actual.initial) {
        const finalCompatible = !wanted.final || wanted.final === actual.final || (FINAL_PARTS[wanted.final] ?? []).includes(actual.final);
        if (wanted.initial !== actual.initial || wanted.medial !== actual.medial || !finalCompatible) matched = false;
      } else if (wanted.raw !== actual.raw) matched = false;
      if (!matched) break;
    }
    if (matched) return true;
  }
  return false;
}

function matchesSearch(value, keyword) {
  const target = normalizeForSearch(value);
  const query = normalizeForSearch(keyword);
  const initials = getInitialSequence(query);
  const isInitialQuery = Array.from(initials).length > 0 && Array.from(initials).every((char) => INITIAL_SET.has(char));
  return target.includes(query)
    || jamoSequence(target).includes(jamoSequence(query))
    || (isInitialQuery && getInitialSequence(target).includes(initials))
    || matchesHangulPart(target, query);
}

function formatDate(value) {
  if (!value) return '—';
  const parsed = dayjs(value);
  if (!parsed.isValid()) return value;
  return `${parsed.format('YYYY.MM.DD HH:mm')} (${parsed.fromNow()})`;
}

export default function App() {
  const [stations, setStations] = useState([]);
  const [filters, setFilters] = useState({ stationName: '', subwayLine: '', location: '' });
  const [showModal, setShowModal] = useState(false);
  const [editingStation, setEditingStation] = useState(null);
  const [detailNo, setDetailNo] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingNo, setDeletingNo] = useState(null);
  const [notice, setNotice] = useState(null);

  const loadStations = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request(API_URL);
      if (!Array.isArray(data)) throw new Error('Station 목록 응답 형식이 올바르지 않습니다.');
      setStations(data);
    } catch (error) {
      setNotice({ variant: 'danger', message: error.message || '목록을 불러오지 못했습니다.' });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadStations(); }, [loadStations]);

  const visibleStations = useMemo(() => stations.filter((station) => (
    (!filters.stationName.trim() || matchesSearch(station.stationName, filters.stationName.trim()))
    && (!filters.subwayLine.trim() || matchesSearch(station.subwayLine, filters.subwayLine.trim()))
    && (!filters.location.trim() || matchesSearch(station.location, filters.location.trim()))
  )), [stations, filters]);
  const selectedStation = stations.find((station) => String(station.stationNo) === String(detailNo));

  function openCreate() {
    setEditingStation(null); setForm(EMPTY_FORM); setNotice(null); setShowModal(true);
  }
  function openEdit(station) {
    setEditingStation(station);
    setForm({ stationName: station.stationName ?? '', subwayLine: station.subwayLine ?? '', location: station.location ?? '' });
    setNotice(null); setShowModal(true);
  }
  function closeModal() {
    if (saving) return;
    setShowModal(false); setEditingStation(null); setForm(EMPTY_FORM);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setNotice(null);
    const body = { stationName: form.stationName.trim(), subwayLine: form.subwayLine.trim(), location: form.location.trim() };
    const isEditing = Boolean(editingStation);
    try {
      if (editingStation) {
        await request(`${API_URL}${encodeURIComponent(editingStation.stationNo)}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stationNo: editingStation.stationNo, ...body }),
        });
      } else {
        await request(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      }
      setShowModal(false); setEditingStation(null); setForm(EMPTY_FORM);
      setNotice({ variant: 'success', message: isEditing ? 'Station 정보를 수정했습니다.' : 'Station을 등록했습니다.' });
      await loadStations();
    } catch (error) {
      setNotice({ variant: 'danger', message: error.message || (isEditing ? '수정하지 못했습니다.' : '등록하지 못했습니다.') });
    } finally { setSaving(false); }
  }

  async function handleDelete(station) {
    if (deletingNo !== null || !window.confirm(`'${station.stationName}' Station을 삭제하시겠습니까?`)) return;
    setDeletingNo(station.stationNo); setNotice(null);
    try {
      await request(`${API_URL}${encodeURIComponent(station.stationNo)}`, { method: 'DELETE' });
      setNotice({ variant: 'success', message: `'${station.stationName}' Station을 삭제했습니다.` });
      setDetailNo(null);
      await loadStations();
    } catch (error) {
      setNotice({ variant: 'danger', message: error.message || '삭제하지 못했습니다.' });
    } finally { setDeletingNo(null); }
  }

  function updateFilter(field, value) { setFilters((current) => ({ ...current, [field]: value })); }

  return (
    <Container className="py-4 py-md-5">
      <header className="page-header mb-4">
        <div>
          <div className="eyebrow">TRANSIT DIRECTORY</div>
          <h1 className="mb-1">Station 관리</h1>
          <p className="text-body-secondary mb-0">역 정보와 노선 정보를 관리합니다.</p>
        </div>
        {detailNo === null && <Button onClick={openCreate} disabled={loading || saving}>Station 등록</Button>}
      </header>

      {notice && <Alert variant={notice.variant} dismissible onClose={() => setNotice(null)}>{notice.message}</Alert>}

      {detailNo !== null ? (
        <>
          <div className="d-flex align-items-center justify-content-between mb-3">
            <Button variant="link" className="px-0 text-decoration-none" onClick={() => setDetailNo(null)}>← 목록으로</Button>
            {selectedStation && <div className="d-flex gap-2"><Button variant="outline-primary" onClick={() => openEdit(selectedStation)}>수정</Button><Button variant="outline-danger" onClick={() => handleDelete(selectedStation)} disabled={deletingNo !== null}>{deletingNo !== null ? <Spinner size="sm" animation="border" /> : '삭제'}</Button></div>}
          </div>
          {selectedStation ? <Card className="detail-card"><Card.Body className="p-4 p-md-5">
            <div className="eyebrow">STATION DETAILS</div><h2 className="detail-title">{selectedStation.stationName}</h2>
            <span className="line-badge">{selectedStation.subwayLine}</span>
            <dl className="detail-list mt-4 mb-0">
              <div><dt>역번호</dt><dd>{selectedStation.stationNo}</dd></div>
              <div><dt>위치</dt><dd>{selectedStation.location || '—'}</dd></div>
              <div><dt>생성일</dt><dd>{formatDate(selectedStation.ctime)}</dd></div>
              <div><dt>수정일</dt><dd>{formatDate(selectedStation.utime)}</dd></div>
            </dl>
          </Card.Body></Card> : <Alert variant="warning">Station 정보를 찾을 수 없습니다. <Button variant="link" onClick={() => setDetailNo(null)}>목록으로 돌아가기</Button></Alert>}
        </>
      ) : <>
        <section className="search-panel p-3 p-md-4 mb-4" aria-label="Station 실시간 검색">
          <Row className="g-3">
            <Col xs={12} sm={6} lg={4}><Form.Label htmlFor="station-search">역명</Form.Label><Form.Control id="station-search" value={filters.stationName} onChange={(event) => updateFilter('stationName', event.target.value)} placeholder="역명 입력" /></Col>
            <Col xs={12} sm={6} lg={4}><Form.Label htmlFor="line-search">노선</Form.Label><Form.Control id="line-search" value={filters.subwayLine} onChange={(event) => updateFilter('subwayLine', event.target.value)} placeholder="노선 입력" /></Col>
            <Col xs={12} sm={6} lg={4}><Form.Label htmlFor="location-search">위치</Form.Label><Form.Control id="location-search" value={filters.location} onChange={(event) => updateFilter('location', event.target.value)} placeholder="위치 입력" /></Col>
          </Row>
        </section>

        <div className="d-flex justify-content-between align-items-center mb-3">
          <h2 className="section-title mb-0">Station 목록</h2><span className="small text-body-secondary">{loading ? '불러오는 중' : `${visibleStations.length}개`}</span>
        </div>
        {loading ? <div className="loading-panel"><Spinner animation="border" size="sm" className="me-2" />Station 목록을 불러오는 중입니다.</div>
          : visibleStations.length === 0 ? <div className="empty-state text-center py-5">{stations.length ? '검색 결과가 없습니다.' : '등록된 Station이 없습니다.'}</div>
            : <Row className="g-3">{visibleStations.map((station) => <Col xs={12} sm={6} lg={4} key={station.stationNo}>
              <Card className="station-card h-100" role="button" tabIndex={0} onClick={() => setDetailNo(station.stationNo)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setDetailNo(station.stationNo); }}>
                <Card.Body className="p-4"><div className="d-flex justify-content-between align-items-start gap-2"><div><div className="station-number-label">STATION {station.stationNo}</div><h3 className="station-name">{station.stationName}</h3></div><span className="line-badge">{station.subwayLine}</span></div><div className="card-link-hint mt-3">상세 정보 보기 <span aria-hidden="true">→</span></div></Card.Body>
              </Card>
            </Col>)}</Row>}
      </>}

      <Modal show={showModal} onHide={closeModal} centered>
        <Form onSubmit={handleSubmit}>
          <Modal.Header closeButton={!saving}><Modal.Title>{editingStation ? 'Station 수정' : 'Station 등록'}</Modal.Title></Modal.Header>
          <Modal.Body>
            {editingStation && <div className="station-number mb-3"><span className="text-body-secondary">역번호</span><strong>{editingStation.stationNo}</strong></div>}
            <Form.Group className="mb-3"><Form.Label htmlFor="station-name">역명</Form.Label><Form.Control id="station-name" required maxLength={90} autoFocus value={form.stationName} onChange={(event) => setForm({ ...form, stationName: event.target.value })} /></Form.Group>
            <Form.Group className="mb-3"><Form.Label htmlFor="subway-line">노선</Form.Label><Form.Control id="subway-line" required maxLength={90} value={form.subwayLine} onChange={(event) => setForm({ ...form, subwayLine: event.target.value })} /></Form.Group>
            <Form.Group><Form.Label htmlFor="station-location">위치 <span className="text-body-secondary">(선택)</span></Form.Label><Form.Control id="station-location" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></Form.Group>
          </Modal.Body>
          <Modal.Footer><Button variant="outline-secondary" onClick={closeModal} disabled={saving}>취소</Button><Button type="submit" disabled={saving}>{saving && <Spinner size="sm" animation="border" className="me-2" />}{editingStation ? '수정' : '등록'}</Button></Modal.Footer>
        </Form>
      </Modal>
    </Container>
  );
}
