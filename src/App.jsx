import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Helper to retrieve cookies
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

// Helper to delete cookies
function deleteCookie(name) {
    document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT; SameSite=Strict`;
}

// Helper to format ISO timestamps
function formatDateTime(isoString) {
    if (!isoString) return { date: 'N/A', time: 'N/A' };
    try {
        const d = new Date(isoString);
        if (isNaN(d.getTime())) return { date: 'N/A', time: 'N/A' };
        return {
            date: d.toLocaleDateString(),
            time: d.toLocaleTimeString()
        };
    } catch (e) {
        return { date: 'N/A', time: 'N/A' };
    }
}

// Standard clinical 10-20 layout, independent of the 3D mesh entirely.
// Outer ring coordinates are corrected to exactly r: 0.90 to make a perfect concentric circle,
// and central/midline values are balanced to 0.45. F3/F4 and P3/P4 sit at 0.58.
const STANDARD_1020_POLAR = {
    Cz: { r: 0.00, theta: 0 },
    Fz: { r: 0.45, theta: 0 },   Pz: { r: 0.45, theta: 180 },
    Fp1: { r: 0.90, theta: -18 }, Fp2: { r: 0.90, theta: 18 },
    F7: { r: 0.90, theta: -54 },  F3: { r: 0.58, theta: -39 }, F4: { r: 0.58, theta: 39 },  F8: { r: 0.90, theta: 54 },
    T3: { r: 0.90, theta: -90 },  C3: { r: 0.45, theta: -90 }, C4: { r: 0.45, theta: 90 },  T4: { r: 0.90, theta: 90 },
    T5: { r: 0.90, theta: -126 }, P3: { r: 0.58, theta: -141 }, P4: { r: 0.58, theta: 141 }, T6: { r: 0.90, theta: 126 },
    O1: { r: 0.90, theta: -162 }, O2: { r: 0.90, theta: 162 }
};

const BANDS = ['alpha', 'beta', 'theta', 'delta', 'gamma'];

const BAND_COLORS = {
    delta: { r: 245 / 255, g: 235 / 255, b: 214 / 255, hex: '#f5ebd6' },
    theta: { r: 16 / 255, g: 185 / 255, b: 129 / 255, hex: '#10b981' },
    alpha: { r: 139 / 255, g: 92 / 255, b: 246 / 255, hex: '#8b5cf6' },
    beta: { r: 236 / 255, g: 72 / 255, b: 153 / 255, hex: '#ec4899' },
    gamma: { r: 6 / 255, g: 182 / 255, b: 212 / 255, hex: '#06b6d4' }
};

const SPECTRAL_R_MAP = [[0.3686, 0.3098, 0.6353], [0.2468, 0.4676, 0.7100], [0.2800, 0.6270, 0.7024], [0.4318, 0.7732, 0.6466], [0.6334, 0.8521, 0.6437], [0.8022, 0.9202, 0.6164], [0.9289, 0.9715, 0.6381], [0.9999, 0.9976, 0.7450], [0.9972, 0.9118, 0.6011], [0.9944, 0.7938, 0.4740], [0.9873, 0.6474, 0.3642], [0.9610, 0.4574, 0.2766], [0.8854, 0.3190, 0.2904], [0.7719, 0.1728, 0.2948], [0.6196, 0.0039, 0.2588]];
const TURBO_MAP = [[0.18995, 0.07176, 0.23217], [0.22851, 0.17709, 0.47167], [0.23612, 0.31688, 0.71804], [0.20324, 0.47402, 0.90685], [0.12571, 0.62779, 0.98565], [0.08832, 0.76012, 0.94199], [0.16911, 0.85237, 0.79383], [0.34228, 0.90566, 0.56942], [0.55743, 0.90807, 0.34005], [0.77395, 0.86016, 0.17833], [0.93282, 0.74823, 0.10398], [0.99264, 0.58434, 0.08115], [0.96347, 0.39515, 0.09630], [0.86795, 0.21205, 0.14810], [0.72038, 0.07414, 0.19762]];
const VIRIDIS_MAP = [[0.267004, 0.004874, 0.329415], [0.282623, 0.114008, 0.389644], [0.274055, 0.219878, 0.478085], [0.238443, 0.322022, 0.541302], [0.191795, 0.415187, 0.561908], [0.151329, 0.501929, 0.557985], [0.119058, 0.584285, 0.540192], [0.101143, 0.663523, 0.512908], [0.122247, 0.739775, 0.468003], [0.208620, 0.811857, 0.396501], [0.346897, 0.876008, 0.293347], [0.528438, 0.927027, 0.170417], [0.740137, 0.962804, 0.090705], [0.935582, 0.978617, 0.154320], [0.993248, 0.906161, 0.143936]];

function getColormapColor(v, cmapName) {
    v = Math.max(0.0, Math.min(1.0, v));
    let cmap = SPECTRAL_R_MAP;
    if (cmapName === 'viridis') cmap = VIRIDIS_MAP;
    else if (cmapName === 'turbo') cmap = TURBO_MAP;
    const idx = v * (cmap.length - 1); const i = Math.floor(idx); const f = idx - i;
    if (i >= cmap.length - 1) return { r: cmap[i][0], g: cmap[i][1], b: cmap[i][2] };
    return { r: cmap[i][0] * (1 - f) + cmap[i + 1][0] * f, g: cmap[i][1] * (1 - f) + cmap[i + 1][1] * f, b: cmap[i][2] * (1 - f) + cmap[i + 1][2] * f };
}

function getElectrodeTopoplotPositions(cx, cy, radius, names) {
    if (!names) return [];
    return names.map((name, idx) => {
        const pos = STANDARD_1020_POLAR[name] || { r: 0, theta: 0 };
        const thetaRad = pos.theta * Math.PI / 180;
        const mappedX = cx + Math.sin(thetaRad) * pos.r * radius * 0.9;
        const mappedY = cy - Math.cos(thetaRad) * pos.r * radius * 0.9;
        return { name, x: mappedX, y: mappedY, idx };
    });
}

// --- SUB-COMPONENTS ---
const LoginView = ({ onLogin }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const response = await fetch(`/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: username.trim(), password })
            });
            const data = await response.json();
            const token = data?.data?.tokens?.access_token || data?.access_token || data?.token || data?.data?.access_token;
            if (token) {
                document.cookie = `jwt-token=${token}; path=/; max-age=86400; SameSite=Lax`;
                onLogin(token);
            } else {
                setError('Authentication failed. Check credentials.');
            }
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <div style={{ width: '100vw', height: '100vh', backgroundColor: '#0b0f19', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'absolute', top: 0, left: 0, zIndex: 100 }}>
            <div style={{ background: 'rgba(17, 24, 43, 0.8)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '16px', padding: '40px', width: '100%', maxWidth: '440px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ background: '#ffffff', padding: '12px', borderRadius: '12px', display: 'inline-block', marginBottom: '16px', boxShadow: '0 4px 15px rgba(0,0,0,0.2)' }}>
                        <img src="/logo.jpg" alt="Avinya NeuroTech Logo" style={{ width: '140px', height: 'auto', display: 'block' }} />
                    </div>
                    <p style={{ fontSize: '14px', color: '#64748b', margin: 0, fontFamily: "'Outfit', sans-serif" }}>Epileptiform Source Localization Console</p>
                </div>
                {error && (
                    <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#f87171', padding: '12px', borderRadius: '8px', fontSize: '13px' }}>
                        {error}
                    </div>
                )}
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', color: '#94a3b8', marginBottom: '8px' }}>Username</label>
                        <input type="text" placeholder="username" value={username} onChange={e => setUsername(e.target.value)} style={{ width: '100%', background: '#090d16', border: '1px solid #1e293b', borderRadius: '8px', padding: '12px', color: '#ffffff' }} required />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', color: '#94a3b8', marginBottom: '8px' }}>Password</label>
                        <input type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} style={{ width: '100%', background: '#090d16', border: '1px solid #1e293b', borderRadius: '8px', padding: '12px', color: '#ffffff' }} required />
                    </div>
                    <button type="submit" style={{ background: 'linear-gradient(90deg, #0ea5e9, #2563eb)', border: 'none', borderRadius: '8px', padding: '14px', color: '#ffffff', fontWeight: 700, cursor: 'pointer' }}>
                        <span>Enter Control Center</span>
                    </button>
                </form>
            </div>
        </div>
    );
};

const DashboardView = ({ token, onLogout, onSelectPatient }) => {
    const [patients, setPatients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchPatients = async () => {
            try {
                const response = await fetch(`/auth/patients?q=&department=-1`, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
                });
                const data = await response.json();
                if (response.ok && data.success) {
                    setPatients(data.data?.patients || []);
                } else {
                    throw new Error(data.message || 'Failed to retrieve patient directory.');
                }
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };
        fetchPatients();
    }, [token]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', backgroundColor: '#f8fafc', color: '#0f172a', position: 'absolute', top: 0, left: 0, zIndex: 50, overflowY: 'auto' }}>
            <header style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '16px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <img src="/logo-circle.jpg" alt="Avinya Logo" style={{ width: '42px', height: '42px', borderRadius: '50%', border: '1px solid #e2e8f0' }} />
                    <div>
                        <h1 style={{ fontSize: '18px', fontWeight: 800, margin: 0, fontFamily: "'Space Grotesk', sans-serif" }}>Avinya Clinical Console</h1>
                        <span style={{ fontSize: '11px', color: '#0ea5e9', fontWeight: 600, letterSpacing: '0.05em' }}>SECURE CONNECTION ACTIVE</span>
                    </div>
                </div>
                <div>
                    <button onClick={onLogout} style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.15)', borderRadius: '6px', padding: '8px 14px', color: '#ef4444', fontSize: '12px', cursor: 'pointer' }}>Sign Out</button>
                </div>
            </header>
            <main style={{ padding: '24px', boxSizing: 'border-box', width: '100%' }}>
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px 0' }}>
                    <div style={{ padding: '0 24px 20px 24px', borderBottom: '1px solid #f1f5f9' }}>
                        <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>Patient List</h2>
                    </div>
                    {loading && <div style={{ textAlign: 'center', padding: '60px', color: '#64748b' }}>Loading patient database entries...</div>}
                    {error && <div style={{ margin: '24px', padding: '16px', background: 'rgba(239, 68, 68, 0.05)', color: '#ef4444' }}>{error}</div>}
                    {!loading && !error && (
                        <div style={{ padding: '0 24px' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid #e2e8f0', textAlign: 'center', fontSize: '11px', color: '#64748b' }}>
                                        <th style={{ padding: '12px' }}>PATIENT</th>
                                        <th style={{ padding: '12px' }}>GENDER</th>
                                        <th style={{ padding: '12px' }}>DEPARTMENT</th>
                                        <th style={{ padding: '12px' }}>UHID</th>
                                        <th style={{ padding: '12px' }}>TIME</th>
                                        <th style={{ padding: '12px' }}>DATE</th>
                                        <th style={{ padding: '12px' }}>DETAILS</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {patients.map((p, idx) => {
                                        const { date, time } = formatDateTime(p.created_at);
                                        return (
                                            <tr key={p.id} style={{ background: idx % 2 === 1 ? '#f8fafc' : '#ffffff' }}>
                                                <td style={{ padding: '14px', fontWeight: 600, textAlign: 'center' }}>{p.full_name || 'Subject'}</td>
                                                <td style={{ padding: '14px', textAlign: 'center' }}>{p.gender || 'MALE'}</td>
                                                <td style={{ padding: '14px', textAlign: 'center' }}>{p.department || 'Neurology'}</td>
                                                <td style={{ padding: '14px', fontFamily: 'monospace', textAlign: 'center' }}>{p.uhid || 'N/A'}</td>
                                                <td style={{ padding: '14px', textAlign: 'center' }}>{time}</td>
                                                <td style={{ padding: '14px', textAlign: 'center' }}>{date}</td>
                                                <td style={{ padding: '14px', textAlign: 'center' }}>
                                                    <button onClick={() => onSelectPatient(p)} style={{ background: '#0ea5e9', color: '#ffffff', padding: '6px 12px', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>View</button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
};

const PatientDetailsView = ({ patient, token, onBack, onSelectFile }) => {
    const [files, setFiles] = useState([]);
    const [activeTab, setActiveTab] = useState('Ongoing');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchFiles = async () => {
            try {
                const response = await fetch(`/files/file?patient_id=${encodeURIComponent(patient.id)}`, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
                });
                const data = await response.json();
                if (response.ok && data.success) {
                    setFiles(data.data || []);
                } else {
                    throw new Error(data.message || 'Failed to retrieve patient files.');
                }
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };
        fetchFiles();
    }, [patient.id, token]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', backgroundColor: '#f8fafc', position: 'absolute', top: 0, left: 0, zIndex: 50, overflowY: 'auto' }}>
            <header style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '16px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <button onClick={onBack} style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '50%', width: '36px', height: '36px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="19" y1="12" x2="5" y2="12"></line>
                            <polyline points="12 19 5 12 12 5"></polyline>
                        </svg>
                    </button>
                    <img src="/logo-circle.jpg" alt="Avinya Logo" style={{ width: '36px', height: '36px', borderRadius: '50%', border: '1px solid #e2e8f0' }} />
                    <h1 style={{ fontSize: '18px', fontWeight: 800, margin: 0, fontFamily: "'Space Grotesk', sans-serif" }}>Patient File Directory</h1>
                </div>
            </header>
            <main style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '32px' }}>
                    <h2 style={{ fontSize: '24px', fontWeight: 800, margin: '0 0 20px 0' }}>{patient.full_name || 'Subject'}</h2>
                    <div style={{ background: '#f8fafc', padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                        <div><span style={{ color: '#64748b' }}>Department: </span><span style={{ fontWeight: 700 }}>{patient.department || 'Neurology'}</span></div>
                        <div><span style={{ color: '#64748b' }}>UHID: </span><span style={{ fontWeight: 700, fontFamily: 'monospace' }}>{patient.uhid || 'N/A'}</span></div>
                        <div><span style={{ color: '#64748b' }}>Gender: </span><span style={{ fontWeight: 700 }}>{patient.gender || 'MALE'}</span></div>
                    </div>
                </div>
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px 0' }}>
                    <div style={{ display: 'flex', padding: '0 24px', borderBottom: '1px solid #e2e8f0', marginBottom: '16px' }}>
                        {['Todo', 'Ongoing', 'Completed'].map(tab => {
                            const isTabActive = activeTab === tab;
                            return (
                                <button key={tab} onClick={() => setActiveTab(tab)} style={{ background: 'none', border: 'none', borderBottom: isTabActive ? '3px solid #0ea5e9' : '3px solid transparent', padding: '10px', fontWeight: 700, color: isTabActive ? '#0ea5e9' : '#64748b', cursor: 'pointer', fontFamily: 'inherit' }}>
                                    {tab} ({tab === 'Ongoing' ? files.length : 0})
                                </button>
                            );
                        })}
                    </div>
                    <div style={{ padding: '0 24px' }}>
                        {loading && <div style={{ textAlign: 'center', padding: '60px', color: '#64748b' }}>Loading telemetry directory...</div>}
                        {error && <div style={{ color: '#ef4444', padding: '16px' }}>{error}</div>}
                        {!loading && !error && (
                            <div>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid #f1f5f9', color: '#475569', fontSize: '12px' }}>
                                            <th style={{ padding: '12px', textAlign: 'left' }}>ID</th>
                                            <th style={{ padding: '12px', textAlign: 'left' }}>TIME</th>
                                            <th style={{ padding: '12px', textAlign: 'left' }}>DATE</th>
                                            <th style={{ padding: '12px', textAlign: 'center' }}>ACTION</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {activeTab !== 'Ongoing' || !files.length ? (
                                            <tr><td colSpan="4" style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>No active telemetry files in this tab.</td></tr>
                                        ) : (
                                            files.map(f => {
                                                const fTime = formatDateTime(f.created_at);
                                                return (
                                                    <tr key={f.id}>
                                                        <td style={{ padding: '14px', fontWeight: 700 }}>{f.id.substring(f.id.length - 6).toUpperCase()}</td>
                                                        <td style={{ padding: '14px' }}>{fTime.time}</td>
                                                        <td style={{ padding: '14px' }}>{fTime.date}</td>
                                                        <td style={{ padding: '14px', textAlign: 'center' }}>
                                                            <button onClick={() => onSelectFile(f)} style={{ background: '#0ea5e9', color: '#fff', border: 'none', borderRadius: '4px', padding: '6px 14px', cursor: 'pointer' }}>Launch Engine</button>
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
};

const VisualizerView = ({ selectedPatient, selectedFile, token, onBack }) => {
    const container3dRef = useRef(null);
    const canvas2dRef = useRef(null);
    const eegCanvasRef = useRef(null);
    const requestRef = useRef(null);

    // Three.js and animation hooks refs
    const resourcesRef = useRef({
        scene: null, camera: null, renderer: null, controls: null,
        headMesh: null, phantomHeadShaderMaterial: null,
        mainLight: null, rimLight: null, raycaster: new THREE.Raycaster(),
        mouse: new THREE.Vector2(), hoveredElectrode: null,
        electrodeMeshes: [], electrodeLabels: [],
        M_flat: null, vertexCount: 0, channelCount: 19, paintableMask: null,
        U_vertex_s1: null, U_vertex_s2: null, U_smoothed: null,
        U_vertex_s1_all: {}, U_vertex_s2_all: {}, U_smoothed_all: {},
        cached_s1: -1, cached_s2: -1, cached_band: '', cached_mode: '',
        phaseOffsets: [], bandMinMax: {
            delta: { min: 0, max: 1 }, theta: { min: 0, max: 1 },
            alpha: { min: 0, max: 1 }, beta: { min: 0, max: 1 },
            gamma: { min: 0, max: 1 }
        },
        lastFrameTime: performance.now(), tooltipX: 0, tooltipY: 0
    });

    // React component control parameters
    const [activeBand, setActiveBand] = useState('alpha');
    const [activeColormap, setActiveColormap] = useState('spectral_r');
    const [activeMode, setActiveMode] = useState('heatmap');
    const [activeMetric, setActiveMetric] = useState('normalized');
    
    const [isPlaying, setIsPlaying] = useState(true);
    const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
    
    const [headmodelOpacity, setHeadmodelOpacity] = useState(0.85);
    const [heatmapOpacity, setHeatmapOpacity] = useState(0.90);
    
    const [timeText, setTimeText] = useState('00:00 / --:--');
    const [currentTime, setCurrentTime] = useState(0);
    const [maxTime, setMaxTime] = useState(170);
    
    const [is3dVisible, setIs3dVisible] = useState(true);
    const [averages, setAverages] = useState({ delta: '0.0', theta: '0.0', alpha: '0.0', beta: '0.0', gamma: '0.0' });
    const [dist, setDist] = useState({ delta: '0.0', theta: '0.0', alpha: '0.0', beta: '0.0', gamma: '0.0' });
    
    const [config, setConfig] = useState(null);
    const [loadingState, setLoadingState] = useState('Initializing mesh config...');
    const [timeslots, setTimeslots] = useState([]);

    // Sync state values to refs for 60fps render loop context access
    const renderLoopStateRef = useRef({
        activeBand, activeColormap, activeMode, activeMetric,
        isPlaying, playbackSpeed, headmodelOpacity, heatmapOpacity,
        currentTime, maxTime, config: null
    });

    useEffect(() => {
        renderLoopStateRef.current = {
            activeBand, activeColormap, activeMode, activeMetric,
            isPlaying, playbackSpeed, headmodelOpacity, heatmapOpacity,
            currentTime, maxTime, config
        };
    }, [activeBand, activeColormap, activeMode, activeMetric, isPlaying, playbackSpeed, headmodelOpacity, heatmapOpacity, currentTime, maxTime, config]);

    // Sync uniform changes immediately
    useEffect(() => {
        // Opacities now solid by default, u_opacity/u_heatmapOpacity removed
    }, [headmodelOpacity, heatmapOpacity]);

    const handlePlayPause = () => {
        setIsPlaying(prev => !prev);
    };

    const handleSpeedChange = (speed) => {
        setPlaybackSpeed(speed);
    };

    const handleTimeSliderChange = (e) => {
        const val = parseFloat(e.target.value);
        setCurrentTime(val);
    };

    const handleTimeslotChange = (e) => {
        const val = e.target.value.split('-');
        const start = parseInt(val[0]);
        const end = parseInt(val[1]);
        fetchBandpowerChunk(start, end);
    };

    // Main Telemetry Loading Orchestrator
    useEffect(() => {
        const container = container3dRef.current;
        const res = resourcesRef.current;

        // 1. Initialize Three.js scene
        res.scene = new THREE.Scene();
        res.scene.background = new THREE.Color(0xf8f9fc);

        res.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
        res.camera.position.set(0, 30, 240);

        res.renderer = new THREE.WebGLRenderer({ antialias: true });
        res.renderer.setSize(container.clientWidth, container.clientHeight);
        res.renderer.setPixelRatio(window.devicePixelRatio);
        container.appendChild(res.renderer.domElement);

        res.controls = new OrbitControls(res.camera, res.renderer.domElement);
        res.controls.enableDamping = true;
        res.controls.dampingFactor = 0.05;
        res.controls.target.set(0, -15, 0);

        res.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        res.mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
        res.mainLight.position.set(0, 200, 100);
        res.scene.add(res.mainLight);

        res.rimLight = new THREE.DirectionalLight(0xaaccff, 0.45);
        res.rimLight.position.set(-100, 100, -100);
        res.scene.add(res.rimLight);

        // Fetch initial mesh config
        const fetchMeshAndStart = async () => {
            try {
                setLoadingState('Retrieving 3D BEM scalp mesh...');
                const meshRes = await fetch('/api/mesh-config', { headers: { 'Authorization': `Bearer ${token}` } });
                const cfg = await meshRes.json();
                
                // Set layout channels & phase offsets
                const chCount = cfg.channel_count || cfg.electrodes.names.length;
                res.channelCount = chCount;
                
                res.phaseOffsets = [];
                for (let c = 0; c < chCount; c++) {
                    res.phaseOffsets[c] = {};
                    BANDS.forEach(b => {
                        res.phaseOffsets[c][b] = Math.sin(c * 7.7 + b.charCodeAt(0)) * Math.PI * 2;
                    });
                }

                // Geometry Assembly
                const geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cfg.vertices.flat()), 3));
                geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(cfg.faces.flat()), 1));
                res.vertexCount = cfg.vertices.length;
                geometry.computeVertexNormals();

                res.paintableMask = cfg.paintable_mask || new Array(res.vertexCount).fill(1);
                geometry.setAttribute('a_paintable', new THREE.BufferAttribute(new Float32Array(res.paintableMask), 1));
                geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(res.vertexCount * 3), 3));

                // Process Perrin Projection Weights for GPU Offloading
                const V = res.vertexCount;
                const w0 = new Float32Array(V * 4);
                const w1 = new Float32Array(V * 4);
                const w2 = new Float32Array(V * 4);
                const w3 = new Float32Array(V * 4);
                const w4 = new Float32Array(V * 3);

                for (let j = 0; j < V; j++) {
                    const row = cfg.projection_matrix[j];
                    w0[j * 4 + 0] = row[0];
                    w0[j * 4 + 1] = row[1];
                    w0[j * 4 + 2] = row[2];
                    w0[j * 4 + 3] = row[3];

                    w1[j * 4 + 0] = row[4];
                    w1[j * 4 + 1] = row[5];
                    w1[j * 4 + 2] = row[6];
                    w1[j * 4 + 3] = row[7];

                    w2[j * 4 + 0] = row[8];
                    w2[j * 4 + 1] = row[9];
                    w2[j * 4 + 2] = row[10];
                    w2[j * 4 + 3] = row[11];

                    w3[j * 4 + 0] = row[12];
                    w3[j * 4 + 1] = row[13];
                    w3[j * 4 + 2] = row[14];
                    w3[j * 4 + 3] = row[15];

                    w4[j * 3 + 0] = row[16];
                    w4[j * 3 + 1] = row[17];
                    w4[j * 3 + 2] = row[18];
                }

                geometry.setAttribute('a_projWeight0', new THREE.BufferAttribute(w0, 4));
                geometry.setAttribute('a_projWeight1', new THREE.BufferAttribute(w1, 4));
                geometry.setAttribute('a_projWeight2', new THREE.BufferAttribute(w2, 4));
                geometry.setAttribute('a_projWeight3', new THREE.BufferAttribute(w3, 4));
                geometry.setAttribute('a_projWeight4', new THREE.BufferAttribute(w4, 3));

                // Shader Material configuration
                // Solid Head, depthWrite: true, opaque rendering.
                res.phantomHeadShaderMaterial = new THREE.ShaderMaterial({
                    uniforms: {
                        u_activeColormap: { value: 0 },
                        u_activeMode: { value: 0 },
                        u_faceColor: { value: new THREE.Color(0xdddddd) },
                        u_mainLightDir: { value: new THREE.Vector3() },
                        u_rimLightDir: { value: new THREE.Vector3() },
                        u_cameraPos: { value: new THREE.Vector3() },
                        u_channelValues: { value: new Float32Array(19) },
                        u_minVal: { value: 0.0 },
                        u_maxVal: { value: 1.0 }
                    },
                    transparent: false,
                    depthWrite: true,
                    side: THREE.DoubleSide,
                    vertexShader: `
                        varying vec3 v_WorldNormal; varying vec3 v_WorldPosition; varying vec3 v_ModelPosition;
                        varying float v_interpolatedScalar; varying vec3 v_Color; varying float v_paintable;
                        
                        uniform float u_channelValues[19];
                        uniform float u_minVal;
                        uniform float u_maxVal;
                        
                        attribute vec4 a_projWeight0;
                        attribute vec4 a_projWeight1;
                        attribute vec4 a_projWeight2;
                        attribute vec4 a_projWeight3;
                        attribute vec3 a_projWeight4;
                        attribute float a_paintable;
                        attribute vec3 color;
                        
                        void main() {
                            v_WorldNormal = normalize(vec3(modelMatrix * vec4(normal, 0.0)));
                            v_WorldPosition = vec3(modelMatrix * vec4(position, 1.0));
                            v_ModelPosition = position;
                            
                            // Perrin matrix row weight GPU projection
                            float rawVal = 
                                a_projWeight0.x * u_channelValues[0] +
                                a_projWeight0.y * u_channelValues[1] +
                                a_projWeight0.z * u_channelValues[2] +
                                a_projWeight0.w * u_channelValues[3] +
                                
                                a_projWeight1.x * u_channelValues[4] +
                                a_projWeight1.y * u_channelValues[5] +
                                a_projWeight1.z * u_channelValues[6] +
                                a_projWeight1.w * u_channelValues[7] +
                                
                                a_projWeight2.x * u_channelValues[8] +
                                a_projWeight2.y * u_channelValues[9] +
                                a_projWeight2.z * u_channelValues[10] +
                                a_projWeight2.w * u_channelValues[11] +
                                
                                a_projWeight3.x * u_channelValues[12] +
                                a_projWeight3.y * u_channelValues[13] +
                                a_projWeight3.z * u_channelValues[14] +
                                a_projWeight3.w * u_channelValues[15] +
                                
                                a_projWeight4.x * u_channelValues[16] +
                                a_projWeight4.y * u_channelValues[17] +
                                a_projWeight4.z * u_channelValues[18];
                                
                            v_interpolatedScalar = clamp((rawVal - u_minVal) / max(0.0001, u_maxVal - u_minVal), 0.0, 1.0);
                            v_Color = color;
                            v_paintable = a_paintable;
                            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                        }
                    `,
                    fragmentShader: `
                        precision highp float;
                        varying vec3 v_WorldNormal; varying vec3 v_WorldPosition; varying vec3 v_ModelPosition;
                        varying float v_interpolatedScalar; varying vec3 v_Color; varying float v_paintable;
                        uniform vec3 u_mainLightDir; uniform vec3 u_rimLightDir; uniform vec3 u_cameraPos;
                        uniform vec3 u_faceColor; uniform int u_activeColormap; uniform int u_activeMode;
                        
                        vec3 getSpectralColor(float v) {
                            float r = clamp(4.0*v-1.5,0.0,1.0);
                            float g = clamp(2.0-4.0*abs(v-0.5),0.0,1.0);
                            float b = clamp(1.5-4.0*v,0.0,1.0);
                            return vec3(r,g,b);
                        }
                        
                        void main() {
                            vec3 N = normalize(v_WorldNormal);
                            vec3 V = normalize(u_cameraPos - v_WorldPosition);
                            if(dot(N,V)<0.0) N = -N;
                            
                            // Standard diffuse lighting
                            float diff1 = max(dot(N, normalize(u_mainLightDir)), 0.0);

                            // Compute data topography coloring
                            vec3 heatColor = (u_activeMode == 0)
                                ? getSpectralColor(clamp(v_interpolatedScalar, 0.0, 1.0))
                                : v_Color;
                            
                            // Solid Heatmap Logic: if v_paintable > 0.5, solid heatColor, otherwise u_faceColor
                            vec3 targetColor = (v_paintable > 0.5) ? heatColor : u_faceColor;

                            // Smoothly fade out down the neck base
                            float neckFadeFactor = smoothstep(-120.0, -25.0, v_ModelPosition.y);
                            targetColor = mix(u_faceColor, targetColor, neckFadeFactor);

                            // FINAL COMPOSITE: solid color mapping with diffuse shadow
                            vec3 composite = targetColor * (0.5 + 0.5 * diff1);
                            
                            gl_FragColor = vec4(composite, 1.0); 
                        }
                    `
                });

                res.headMesh = new THREE.Mesh(geometry, res.phantomHeadShaderMaterial);
                res.scene.add(res.headMesh);

                // Render slightly offset glossy dot markers for electrodes to prevent clipping
                res.electrodeMeshes = [];
                cfg.electrodes.coords.forEach((coord, idx) => {
                    const sphere = new THREE.Mesh(
                        new THREE.SphereGeometry(0.9, 16, 16),
                        new THREE.MeshStandardMaterial({ 
                            color: 0x111111, 
                            roughness: 0.7, 
                            metalness: 0.1 
                        })
                    );
                    const scale = 1.03;
                    sphere.position.set(coord[0] * scale, coord[1] * scale, coord[2] * scale);
                    sphere.userData = { index: idx, name: cfg.electrodes.names[idx] };
                    res.scene.add(sphere);
                    res.electrodeMeshes.push(sphere);
                });

                res.M_flat = new Float32Array(cfg.projection_matrix.flat());
                res.U_vertex_s1 = new Float32Array(res.vertexCount);
                res.U_vertex_s2 = new Float32Array(res.vertexCount);
                res.U_smoothed = new Float32Array(res.vertexCount);

                BANDS.forEach(b => {
                    res.U_vertex_s1_all[b] = new Float32Array(res.vertexCount);
                    res.U_vertex_s2_all[b] = new Float32Array(res.vertexCount);
                    res.U_smoothed_all[b] = new Float32Array(res.vertexCount);
                });

                // Set up vertex adjacency map for smoothing
                const adj = Array.from({ length: res.vertexCount }, () => new Set());
                cfg.faces.forEach(([a, b, c]) => {
                    adj[a].add(b); adj[a].add(c);
                    adj[b].add(a); adj[b].add(c);
                    adj[c].add(a); adj[c].add(b);
                });
                res.vertexAdjacency = adj.map(s => Array.from(s));

                setConfig(cfg);
                
                // Build timeslots & fetch initial bandpower chunk
                const totalPoints = cfg.total_points || 1705;
                const endMin = Math.floor((totalPoints - 1) / 60).toString().padStart(2, '0');
                const endSec = Math.floor((totalPoints - 1) % 60).toString().padStart(2, '0');
                setTimeslots([{
                    value: `0-${totalPoints - 1}`,
                    label: `Whole Session (00:00 - ${endMin}:${endSec})`
                }]);

                await fetchBandpowerChunk(0, totalPoints - 1, cfg);
                setLoadingState(null);
            } catch (e) {
                console.error(e);
                setLoadingState('Mesh loading error. Retrying...');
                setTimeout(fetchMeshAndStart, 2000);
            }
        };

        fetchMeshAndStart();

        // Window Resize event listeners
        const handleResize = () => {
            if (!res.renderer || !res.camera || !container) return;
            res.camera.aspect = container.clientWidth / container.clientHeight;
            res.camera.updateProjectionMatrix();
            res.renderer.setSize(container.clientWidth, container.clientHeight);

            // Resize canvases
            if (canvas2dRef.current) {
                const c2d = canvas2dRef.current;
                const sz = Math.min(c2d.parentElement.clientWidth, c2d.parentElement.clientHeight) - 32;
                if (sz > 50) { c2d.width = sz; c2d.height = sz; }
            }
            if (eegCanvasRef.current) {
                const eegc = eegCanvasRef.current;
                eegc.width = eegc.parentElement.clientWidth || 400;
                eegc.height = eegc.parentElement.clientHeight || 140;
            }
        };
        window.addEventListener('resize', handleResize);
        setTimeout(handleResize, 200);

        // Pointer events for raycaster tooltips
        const handlePointerMove = (e) => {
            const rect = container.getBoundingClientRect();
            res.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            res.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            res.tooltipX = e.clientX - rect.left;
            res.tooltipY = e.clientY - rect.top;
        };
        container.addEventListener('pointermove', handlePointerMove);

        // Start Animation Loop
        animate();

        // Cleanup on unmount
        return () => {
            window.removeEventListener('resize', handleResize);
            container.removeEventListener('pointermove', handlePointerMove);
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
            
            // Dispose Three.js objects
            if (res.renderer) {
                res.renderer.dispose();
                if (res.renderer.domElement && res.renderer.domElement.parentNode) {
                    res.renderer.domElement.parentNode.removeChild(res.renderer.domElement);
                }
            }
            if (res.controls) res.controls.dispose();
            if (res.headMesh) {
                res.scene.remove(res.headMesh);
                res.headMesh.geometry.dispose();
                res.headMesh.material.dispose();
            }
            res.electrodeMeshes.forEach(m => {
                res.scene.remove(m);
                m.geometry.dispose();
                m.material.dispose();
            });
        };
    }, []);

    // Asynchronous Bandpower Segment Loading
    const fetchBandpowerChunk = async (start, end, currentCfg = config) => {
        try {
            const target = currentCfg || config;
            if (!target) return;

            const loaderEl = document.getElementById('loader');
            if (loaderEl) loaderEl.style.display = 'flex';

            const response = await fetch(`/api/bandpower-data?start=${start}&end=${end}&file_id=${selectedFile.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const bpData = await response.json();

            const raw = bpData.bandpower_data;
            const transposed = {};
            BANDS.forEach(b => {
                transposed[b] = raw.map(frame => frame[b] || []);
            });
            target.bandpower_data = transposed;

            const rawAbs = bpData.absolute_data;
            const transposedAbs = {};
            BANDS.forEach(b => {
                transposedAbs[b] = rawAbs.map(frame => frame[b] || []);
            });
            target.absolute_data = transposedAbs;

            target.absolute_averages = bpData.absolute_averages;
            target.timestamps = bpData.timestamps;

            resourcesRef.current.globalTimeOffset = start;
            const mTime = target.timestamps.length - 1;
            setMaxTime(mTime);
            setCurrentTime(0);

            // Compute band limits
            BANDS.forEach(b => {
                const m = target.bandpower_data[b];
                if (!m) return;
                let mn = Infinity, mx = -Infinity;
                for (let i = 0; i < m.length; i++) {
                    for (let j = 0; j < m[i].length; j++) {
                        if (m[i][j] < mn) mn = m[i][j];
                        if (m[i][j] > mx) mx = m[i][j];
                    }
                }
                resourcesRef.current.bandMinMax[b] = { min: mn, max: mx };
            });

            if (loaderEl) loaderEl.style.display = 'none';
        } catch (e) {
            console.error("Chunk acquisition failed.", e);
            const loaderEl = document.getElementById('loader');
            if (loaderEl) loaderEl.style.display = 'none';
        }
    };

    // Interpolation projection helper
    const projectChannelsToVertices = (channelValues, outBuffer) => {
        const res = resourcesRef.current;
        for (let j = 0; j < res.vertexCount; j++) {
            let sum = 0.0; const offset = j * res.channelCount;
            for (let c = 0; c < res.channelCount; c++) {
                sum += res.M_flat[offset + c] * channelValues[c];
            }
            outBuffer[j] = sum;
        }
    };

    // Laplacian 1-hop spatial smoothing helper
    const smoothVertexField = (srcS1, srcS2, alpha, outBuffer) => {
        const res = resourcesRef.current;
        for (let j = 0; j < res.vertexCount; j++) {
            if (res.paintableMask[j] < 0.5) { outBuffer[j] = 0.0; continue; }
            let sum = (1.0 - alpha) * srcS1[j] + alpha * srcS2[j];
            let count = 1;
            const neighbors = res.vertexAdjacency[j];
            for (let n = 0; n < neighbors.length; n++) {
                const nj = neighbors[n];
                if (res.paintableMask[nj] < 0.5) continue;
                sum += (1.0 - alpha) * srcS1[nj] + alpha * srcS2[nj];
                count++;
            }
            outBuffer[j] = sum / count;
        }
    };

    // 2D Contour Map Render Logic
    const draw2DTopoplot = (values, minVal, maxVal, cmapName) => {
        const canvas = canvas2dRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        const cx = W / 2, cy = H / 2, radius = W / 2 - 25;
        const imgData = ctx.createImageData(W, H);
        const data = imgData.data;

        const projectedElectrodes = getElectrodeTopoplotPositions(cx, cy, radius, config.electrodes.names).map((e, idx) => ({
            ...e, val: values[idx]
        }));

        const span = maxVal - minVal || 1.0;
        const valGrid = new Float32Array(W * H);
        for (let y = 0; y < H; y++) {
            const dy = y - cy;
            for (let x = 0; x < W; x++) {
                const dx = x - cx;
                if (dx * dx + dy * dy <= radius * radius) {
                    let sumVal = 0, sumWeight = 0;
                    for (let i = 0; i < projectedElectrodes.length; i++) {
                        const w = 1.0 / ((x - projectedElectrodes[i].x) ** 2 + (y - projectedElectrodes[i].y) ** 2 + 120);
                        sumVal += w * projectedElectrodes[i].val;
                        sumWeight += w;
                    }
                    valGrid[y * W + x] = sumVal / sumWeight;
                }
            }
        }

        const step = span / 6;
        for (let y = 0; y < H; y++) {
            const dy = y - cy;
            for (let x = 0; x < W; x++) {
                const dx = x - cx; const idx = y * W + x;
                if (dx * dx + dy * dy <= radius * radius) {
                    const val = valGrid[idx];
                    let isContour = false;
                    if (x < W - 1 && y < H - 1 && (x + 1 - cx) ** 2 + dy * dy <= radius * radius) {
                        if (Math.floor((val - minVal) / step) !== Math.floor((valGrid[idx + 1] - minVal) / step)) isContour = true;
                    }
                    const pIdx = idx * 4;
                    if (isContour) {
                        data[pIdx] = 0; data[pIdx + 1] = 0; data[pIdx + 2] = 0; data[pIdx + 3] = 255;
                    } else {
                        const rgb = getColormapColor((val - minVal) / span, cmapName);
                        data[pIdx] = Math.floor(rgb.r * 255);
                        data[pIdx + 1] = Math.floor(rgb.g * 255);
                        data[pIdx + 2] = Math.floor(rgb.b * 255);
                        data[pIdx + 3] = 255;
                    }
                }
            }
        }

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = W; tempCanvas.height = H;
        tempCanvas.getContext('2d').putImageData(imgData, 0, 0);

        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
        ctx.clip();
        ctx.drawImage(tempCanvas, 0, 0);
        ctx.restore();

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
        ctx.strokeStyle = '#1d1d1f';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Nose indicator
        ctx.beginPath();
        ctx.moveTo(cx - 12, cy - radius + 2);
        ctx.lineTo(cx, cy - radius - 15);
        ctx.lineTo(cx + 12, cy - radius + 2);
        ctx.stroke();

        // Draw markers & text labels
        projectedElectrodes.forEach(e => {
            ctx.beginPath();
            ctx.arc(e.x, e.y, 4, 0, 2 * Math.PI);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            ctx.fillStyle = '#1d1d1f';
            ctx.font = 'bold 9px Space Grotesk, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(e.name, e.x, e.y - 6);
        });
    };

    // 2D Dominant Wave Render Logic
    const draw2DDominantTopoplot = (allBandVals, isNormalized) => {
        const canvas = canvas2dRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        const cx = W / 2, cy = H / 2, radius = W / 2 - 25;
        const imgData = ctx.createImageData(W, H);
        const data = imgData.data;

        const projectedElectrodes = getElectrodeTopoplotPositions(cx, cy, radius, config.electrodes.names);
        const electrodeMeans = {};
        BANDS.forEach(band => {
            let sum = 0;
            if (allBandVals[band]) {
                for (let c = 0; c < resourcesRef.current.channelCount; c++) sum += allBandVals[band][c];
                electrodeMeans[band] = sum / resourcesRef.current.channelCount || 1.0;
            } else {
                electrodeMeans[band] = 1.0;
            }
        });

        for (let y = 0; y < H; y++) {
            const dy = y - cy;
            for (let x = 0; x < W; x++) {
                const dx = x - cx;
                if (dx * dx + dy * dy <= radius * radius) {
                    let sumWeight = 0;
                    const weights = new Float32Array(resourcesRef.current.channelCount);
                    for (let i = 0; i < resourcesRef.current.channelCount; i++) {
                        const d2 = (x - projectedElectrodes[i].x) ** 2 + (y - projectedElectrodes[i].y) ** 2;
                        weights[i] = 1.0 / (d2 + 120);
                        sumWeight += weights[i];
                    }
                    let maxVal = -Infinity, winningBand = 'alpha';
                    BANDS.forEach(band => {
                        if (!allBandVals[band]) return;
                        let sumVal = 0;
                        for (let i = 0; i < resourcesRef.current.channelCount; i++) {
                            sumVal += weights[i] * allBandVals[band][i];
                        }
                        let val = sumVal / sumWeight;
                        if (isNormalized) val /= electrodeMeans[band];
                        if (val > maxVal) {
                            maxVal = val;
                            winningBand = band;
                        }
                    });
                    const color = BAND_COLORS[winningBand];
                    const idx = (y * W + x) * 4;
                    data[idx] = Math.floor(color.r * 255);
                    data[idx + 1] = Math.floor(color.g * 255);
                    data[idx + 2] = Math.floor(color.b * 255);
                    data[idx + 3] = 255;
                }
            }
        }

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = W; tempCanvas.height = H;
        tempCanvas.getContext('2d').putImageData(imgData, 0, 0);

        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
        ctx.clip();
        ctx.drawImage(tempCanvas, 0, 0);
        ctx.restore();

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
        ctx.strokeStyle = '#1d1d1f';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        projectedElectrodes.forEach(e => {
            ctx.beginPath();
            ctx.arc(e.x, e.y, 4, 0, 2 * Math.PI);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        });
    };

    // Raw EEG Voltages Helper
    const getEEGVoltage = (c, t) => {
        const res = resourcesRef.current;
        const cfg = renderLoopStateRef.current.config;
        if (!cfg || !cfg.bandpower_data) return 0.0;
        let signal = 0.0;
        const s_idx = Math.floor(t);
        const alpha = t - s_idx;

        BANDS.forEach((band, bIdx) => {
            const matrix = cfg.bandpower_data[band];
            if (!matrix) return;
            const s1 = Math.min(Math.max(s_idx, 0), matrix.length - 1);
            const s2 = Math.min(Math.max(s_idx + 1, 0), matrix.length - 1);
            const bp = (1.0 - alpha) * matrix[s1][c] + alpha * matrix[s2][c];
            signal += bp * (bIdx === 0 ? 1.4 : 0.5) * Math.sin(2.0 * Math.PI * t * (bIdx + 1) + res.phaseOffsets[c][band]);
        });
        return signal;
    };

    // Draw rolling EEG waves
    const drawEEGWaveforms = (curTime) => {
        const canvas = eegCanvasRef.current;
        const cfg = renderLoopStateRef.current.config;
        if (!canvas || !cfg || !cfg.electrodes) return;

        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        const t_start = curTime - 2, t_end = curTime + 2, span = t_end - t_start;
        const rowH = H / resourcesRef.current.channelCount;

        ctx.strokeStyle = 'rgba(236,72,153,0.15)';
        ctx.lineWidth = 0.5;
        for (let t = Math.ceil(t_start); t <= t_end; t += 0.5) {
            const x = 50 + ((t - t_start) / span) * (W - 50);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, H);
            ctx.stroke();
        }

        for (let c = 0; c < resourcesRef.current.channelCount; c++) {
            ctx.beginPath();
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 1.0;
            for (let x = 50; x < W; x += 2) {
                const t = t_start + ((x - 50) / (W - 50)) * span;
                const v = getEEGVoltage(c, t);
                const y = rowH * (c + 0.5) - v * (rowH * 0.4);
                if (x === 50) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, 50, H);
        ctx.fillStyle = '#475569';
        ctx.font = '9px monospace';
        cfg.electrodes.names.forEach((n, i) => ctx.fillText(n, 10, rowH * (i + 0.5) + 3));

        ctx.strokeStyle = '#ef4444';
        ctx.beginPath();
        ctx.moveTo(W / 2 + 25, 0);
        ctx.lineTo(W / 2 + 25, H);
        ctx.stroke();
    };

    // Interpolate and paint vertices
    const performInterpolationAndColoring = (curTime) => {
        const res = resourcesRef.current;
        const loop = renderLoopStateRef.current;
        const cfg = loop.config;
        if (!cfg || !cfg.bandpower_data || !res.headMesh) return;

        const s_idx = Math.floor(curTime);
        const alpha = Math.min(Math.max(curTime - s_idx, 0.0), 1.0);

        if (loop.activeMode === 'heatmap') {
            res.headMesh.material = res.phantomHeadShaderMaterial;
            const series = cfg.bandpower_data[loop.activeBand];
            if (!series) return;

            const s1 = s_idx, s2 = Math.min(s_idx + 1, series.length - 1);

            const curVals = new Float32Array(res.channelCount);
            for (let c = 0; c < res.channelCount; c++) {
                curVals[c] = (1.0 - alpha) * series[s1][c] + alpha * series[s2][c];
            }

            // Pass live 19-channel values to uniform float array
            res.phantomHeadShaderMaterial.uniforms.u_channelValues.value = curVals;

            // Pass min/max limits for GPU normalization
            const lims = res.bandMinMax[loop.activeBand];
            res.phantomHeadShaderMaterial.uniforms.u_minVal.value = lims.min;
            res.phantomHeadShaderMaterial.uniforms.u_maxVal.value = lims.max;

            draw2DTopoplot(curVals, lims.min, lims.max, loop.activeColormap);

            // Compute dynamic sidebar power percentages
            let totalPower = 0.0;
            const rawFrameAverages = {};
            BANDS.forEach(band => {
                const bandMatrix = cfg.bandpower_data[band];
                if (bandMatrix && bandMatrix[s1]) {
                    let sum = 0;
                    for (let c = 0; c < res.channelCount; c++) sum += bandMatrix[s1][c];
                    const avg = sum / res.channelCount;
                    rawFrameAverages[band] = avg;
                    totalPower += avg;
                } else {
                    rawFrameAverages[band] = 0.0;
                }
            });

            if (totalPower <= 0.0) totalPower = 1.0;
            const newAvgs = {};
            BANDS.forEach(band => {
                newAvgs[band] = ((rawFrameAverages[band] / totalPower) * 100).toFixed(1);
            });
            setAverages(newAvgs);

        } else if (loop.activeMode === 'dominant') {
            res.headMesh.material = res.phantomHeadShaderMaterial;
            const T = cfg.timestamps.length;
            const s1 = s_idx, s2 = Math.min(s_idx + 1, T - 1);
            if (s1 !== res.cached_s1 || s2 !== res.cached_s2 || loop.activeMode !== res.cached_mode) {
                BANDS.forEach(band => {
                    const series = cfg.bandpower_data[band];
                    if (series) {
                        projectChannelsToVertices(series[s1], res.U_vertex_s1_all[band]);
                        projectChannelsToVertices(series[s2], res.U_vertex_s2_all[band]);
                    }
                });
                res.cached_s1 = s1; res.cached_s2 = s2; res.cached_mode = loop.activeMode;
            }

            const V = res.vertexCount;
            let paintableCount = 0;
            for (let j = 0; j < V; j++) if (res.paintableMask[j] > 0.5) paintableCount++;
            if (paintableCount === 0) paintableCount = V;

            BANDS.forEach(band => {
                smoothVertexField(res.U_vertex_s1_all[band], res.U_vertex_s2_all[band], alpha, res.U_smoothed_all[band]);
            });

            const spatialMeans = {};
            BANDS.forEach(band => {
                let sum = 0.0;
                const u_smooth = res.U_smoothed_all[band];
                for (let j = 0; j < V; j++) {
                    if (res.paintableMask[j] > 0.5) sum += u_smooth[j];
                }
                spatialMeans[band] = sum / paintableCount || 1.0;
            });

            const colorAttribute = res.headMesh.geometry.getAttribute('color');
            const bandCounts = { alpha: 0, beta: 0, theta: 0, delta: 0, gamma: 0 };
            const isNormalizedMode = (loop.activeMetric === 'normalized');

            for (let j = 0; j < V; j++) {
                if (res.paintableMask[j] < 0.5) {
                    colorAttribute.setXYZ(j, 0.867, 0.867, 0.867); continue;
                }
                let maxVal = -Infinity;
                let winningBand = 'alpha';
                BANDS.forEach(band => {
                    let val = res.U_smoothed_all[band][j];
                    if (isNormalizedMode) val /= spatialMeans[band];
                    if (val > maxVal) {
                        maxVal = val;
                        winningBand = band;
                    }
                });
                bandCounts[winningBand]++;
                const color = BAND_COLORS[winningBand];
                colorAttribute.setXYZ(j, color.r, color.g, color.b);
            }
            colorAttribute.needsUpdate = true;

            // Update breakdown distributions
            const newDists = {};
            BANDS.forEach(band => {
                const count = bandCounts[band];
                newDists[band] = ((count / paintableCount) * 100).toFixed(1);
            });
            setDist(newDists);

            const allBandVals = {};
            BANDS.forEach(band => {
                const series = cfg.bandpower_data[band];
                if (series) {
                    const bandVals = new Float32Array(res.channelCount);
                    for (let c = 0; c < res.channelCount; c++) {
                        bandVals[c] = (1.0 - alpha) * series[s1][c] + alpha * series[s2][c];
                    }
                    allBandVals[band] = bandVals;
                }
            });
            draw2DDominantTopoplot(allBandVals, isNormalizedMode);
        }
    };

    // Intersect raycaster tooltips
    const checkRaycast = () => {
        const res = resourcesRef.current;
        const loop = renderLoopStateRef.current;
        const cfg = loop.config;
        const tooltip = document.getElementById('tooltip-3d');
        
        if (!res.camera || !res.electrodeMeshes.length || !cfg || !cfg.bandpower_data) {
            if (tooltip) tooltip.style.display = 'none';
            return;
        }

        res.raycaster.setFromCamera(res.mouse, res.camera);
        const intersects = res.raycaster.intersectObjects(res.electrodeMeshes);

        if (res.hoveredElectrode) {
            res.hoveredElectrode.scale.set(1.0, 1.0, 1.0);
            if (res.hoveredElectrode.material) res.hoveredElectrode.material.color.setHex(0x111111);
            res.hoveredElectrode = null;
        }

        if (intersects.length > 0) {
            const sphere = intersects[0].object;
            const idx = sphere.userData.index;
            const name = sphere.userData.name;
            res.hoveredElectrode = sphere;
            sphere.scale.set(1.5, 1.5, 1.5);
            if (sphere.material) sphere.material.color.setHex(0x0088cc);

            let currentVal = 0.0;
            const series = (cfg.absolute_data && cfg.absolute_data[loop.activeBand])
                ? cfg.absolute_data[loop.activeBand]
                : cfg.bandpower_data[loop.activeBand];

            if (series) {
                const t_val = loop.currentTime;
                const s_idx = Math.floor(t_val);
                const alpha = Math.min(Math.max(t_val - s_idx, 0.0), 1.0);
                currentVal = (1.0 - alpha) * series[s_idx][idx] + alpha * series[Math.min(s_idx + 1, series.length - 1)][idx];
            }

            document.getElementById('tooltip-title').textContent = name;
            document.getElementById('tooltip-value').textContent = currentVal.toFixed(2);
            
            if (tooltip) {
                tooltip.style.display = 'block';
                tooltip.style.left = `${res.tooltipX + 15}px`;
                tooltip.style.top = `${res.tooltipY - 15}px`;
            }
        } else {
            if (tooltip) tooltip.style.display = 'none';
        }
    };

    // Main RAF Animation Loop
    const animate = () => {
        requestRef.current = requestAnimationFrame(animate);
        
        const res = resourcesRef.current;
        const loop = renderLoopStateRef.current;
        if (!res.renderer) return;

        const now = performance.now();
        const dt = (now - res.lastFrameTime) / 1000.0;
        res.lastFrameTime = now;

        let curTime = loop.currentTime;
        if (loop.isPlaying && loop.config && loop.config.timestamps) {
            curTime += dt * loop.playbackSpeed;
            if (curTime >= loop.maxTime) curTime = 0.0;
            setCurrentTime(curTime);
        }

        // Render loops
        performInterpolationAndColoring(curTime);
        drawEEGWaveforms(curTime);

        if (res.camera && res.mainLight) {
            res.mainLight.position.copy(res.camera.position);
            if (res.phantomHeadShaderMaterial) {
                res.phantomHeadShaderMaterial.uniforms.u_cameraPos.value.copy(res.camera.position);
                res.phantomHeadShaderMaterial.uniforms.u_mainLightDir.value.copy(res.mainLight.position).normalize();
                res.phantomHeadShaderMaterial.uniforms.u_rimLightDir.value.copy(res.rimLight.position).normalize();
            }
        }

        res.controls.update();
        res.renderer.render(res.scene, res.camera);
        checkRaycast();

        // Dynamic format time display
        const displayTime = res.globalTimeOffset + curTime;
        const displayMin = Math.floor(displayTime / 60).toString().padStart(2, '0');
        const displaySec = Math.floor(displayTime % 60).toString().padStart(2, '0');
        const totalDisplayTime = loop.config && loop.config.total_points ? loop.config.total_points : (loop.maxTime + res.globalTimeOffset);
        const totalMin = Math.floor(totalDisplayTime / 60).toString().padStart(2, '0');
        const totalSec = Math.floor(totalDisplayTime % 60).toString().padStart(2, '0');
        setTimeText(`${displayMin}:${displaySec} / ${totalMin}:${totalSec}`);
    };

    return (
        <div style={{ height: '100vh', width: '100vw', overflow: 'hidden', position: 'relative' }}>
            
            {/* Visualizer Loading overlay */}
            {loadingState && (
                <div id="loader">
                    <div className="spinner"></div>
                    <p>{loadingState}</p>
                </div>
            )}

            <div style={{ position: 'absolute', top: '20px', left: '390px', zIndex: 100, display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button onClick={onBack} style={{ background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: '50%', width: '40px', height: '40px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="19" y1="12" x2="5" y2="12"></line>
                        <polyline points="12 19 5 12 12 5"></polyline>
                    </svg>
                </button>
                <img src="/logo-circle.jpg" alt="Avinya Logo" style={{ width: '40px', height: '40px', borderRadius: '50%', border: '1px solid var(--panel-border)', background: '#ffffff' }} />
                <div style={{ background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: '10px', padding: '6px 14px', fontFamily: "'Space Grotesk', sans-serif", fontSize: '13px', fontWeight: 600, color: 'var(--accent-blue)' }}>
                    <span>{selectedPatient.full_name || 'Subject'}</span>
                </div>
                <select onChange={handleTimeslotChange} style={{ background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: '10px', padding: '6px 14px', fontFamily: "'Space Grotesk', sans-serif", fontSize: '13px', fontWeight: 600, color: 'var(--text-main)', outline: 'none', cursor: 'pointer' }}>
                    {timeslots.map((slot, i) => (
                        <option key={i} value={slot.value}>{slot.label}</option>
                    ))}
                </select>
            </div>

            <div className="ui-overlay">
                <div className="interactive-panel sidebar">
                    <div className="header">
                        <h1>Clinical Head Topography</h1>
                        <p>3D Head Anatomy & Flat Topology Mapping</p>
                    </div>
                    <hr style={{ border: 0, borderTop: '1px solid var(--panel-border)' }} />

                    <div className="section-title">Visualization Mode</div>
                    <div style={{ display: 'flex', background: 'rgba(0,0,0,0.03)', border: '1px solid var(--panel-border)', borderRadius: '10px', padding: '3px' }}>
                        <button onClick={() => setActiveMode('heatmap')} className={`cmap-btn ${activeMode === 'heatmap' ? 'active' : ''}`}>Heatmap</button>
                        <button onClick={() => setActiveMode('dominant')} className={`cmap-btn ${activeMode === 'dominant' ? 'active' : ''}`}>Dominant Wave</button>
                        <button onClick={() => setIs3dVisible(prev => !prev)} className={`cmap-btn ${is3dVisible ? 'active' : ''}`}>3D View</button>
                    </div>
                    <hr style={{ border: 0, borderTop: '1px solid var(--panel-border)' }} />

                    {activeMode === 'heatmap' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                            <div className="legend-container">
                                <div className="section-title">Relative Power Ratio (0.0 - 1.0)</div>
                                <div className="legend-bar"></div>
                                <div className="legend-labels">
                                    <span>{(resourcesRef.current.bandMinMax[activeBand]?.min || 0.0).toFixed(2)}</span>
                                    <span>Power Intensity</span>
                                    <span>{(resourcesRef.current.bandMinMax[activeBand]?.max || 1.0).toFixed(2)}</span>
                                </div>
                            </div>
                            <hr style={{ border: 0, borderTop: '1px solid var(--panel-border)', margin: 0 }} />
                            
                            <div>
                                <div className="section-title">Average Band Power</div>
                                <div className="avg-list">
                                    {BANDS.map(b => (
                                        <div key={b} className="avg-item">
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 500 }}>
                                                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', textTransform: 'capitalize' }}>
                                                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#0088cc' }}></span>
                                                    {b}
                                                </span>
                                                <span className="avg-val">{averages[b]}%</span>
                                            </div>
                                            <div className="avg-bar-bg">
                                                <div className="avg-bar" style={{ width: `${averages[b]}%`, backgroundColor: '#0088cc' }}></div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <hr style={{ border: 0, borderTop: '1px solid var(--panel-border)', margin: 0 }} />
                            
                            <div>
                                <div className="section-title">Brainwave Bands</div>
                                <div className="band-grid">
                                    <button onClick={() => setActiveBand('alpha')} className={activeBand === 'alpha' ? 'active' : ''}>Alpha (8-12 Hz)</button>
                                    <button onClick={() => setActiveBand('beta')} className={activeBand === 'beta' ? 'active' : ''}>Beta (12-30 Hz)</button>
                                    <button onClick={() => setActiveBand('theta')} className={activeBand === 'theta' ? 'active' : ''}>Theta (4-8 Hz)</button>
                                    <button onClick={() => setActiveBand('delta')} className={activeBand === 'delta' ? 'active' : ''}>Delta (0.5-4 Hz)</button>
                                    <button onClick={() => setActiveBand('gamma')} className={activeBand === 'gamma' ? 'active' : ''}>Gamma (30-45 Hz)</button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                            <div className="section-title">Dominance Calculation</div>
                            <div style={{ display: 'flex', background: 'rgba(0,0,0,0.03)', border: '1px solid var(--panel-border)', borderRadius: '10px', padding: '3px' }}>
                                <button onClick={() => setActiveMetric('absolute')} className={`cmap-btn ${activeMetric === 'absolute' ? 'active' : ''}`}>Absolute Power</button>
                                <button onClick={() => setActiveMetric('normalized')} className={`cmap-btn ${activeMetric === 'normalized' ? 'active' : ''}`}>Normalized Power</button>
                            </div>
                            <hr style={{ border: 0, borderTop: '1px solid var(--panel-border)', margin: 0 }} />
                            
                            <div className="section-title">Dominant Wave Distribution</div>
                            <div className="dist-list">
                                {BANDS.map(b => (
                                    <div key={b} className="dist-item">
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 500 }}>
                                            <span style={{ textTransform: 'capitalize' }}>{b}</span>
                                            <span className="dist-val">{dist[b]}%</span>
                                        </div>
                                        <div className="dist-bar-bg">
                                            <div className="dist-bar" style={{ width: `${dist[b]}%`, backgroundColor: BAND_COLORS[b].hex }}></div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    
                    <hr style={{ border: 0, borderTop: '1px solid var(--panel-border)', margin: 0 }} />
                    
                    {/* Opacity Adjustment sliders */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div className="section-title" style={{ marginBottom: '5px' }}>Opacity Settings</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: '500' }}>
                                <span>3D Headmodel Opacity</span>
                                <span style={{ fontFamily: "'Space Grotesk', monospace" }}>{headmodelOpacity.toFixed(2)}</span>
                            </div>
                            <input 
                                type="range" 
                                min="0.1" 
                                max="1.0" 
                                step="0.05" 
                                value={headmodelOpacity}
                                onChange={(e) => setHeadmodelOpacity(parseFloat(e.target.value))}
                            />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: '500' }}>
                                <span>Heatmap Overlay Opacity</span>
                                <span style={{ fontFamily: "'Space Grotesk', monospace" }}>{heatmapOpacity.toFixed(2)}</span>
                            </div>
                            <input 
                                type="range" 
                                min="0.0" 
                                max="1.0" 
                                step="0.05" 
                                value={heatmapOpacity}
                                onChange={(e) => setHeatmapOpacity(parseFloat(e.target.value))}
                            />
                        </div>
                    </div>
                    
                    <hr style={{ border: 0, borderTop: '1px solid var(--panel-border)', margin: 0 }} />

                    <div className="info-card">
                        <div className="section-title" style={{ marginBottom: '5px' }}>Session Metadata</div>
                        <div className="info-row"><span className="info-label">Patient ID:</span><span className="info-value">{selectedPatient.id.substring(0, 8).toUpperCase()}</span></div>
                        <div className="info-row"><span className="info-label">Display Mode:</span><span className="info-value">Full Anatomy Head Bust</span></div>
                        <div className="info-row"><span className="info-label">Mesh Vertices:</span><span className="info-value">{config ? config.vertices.length : 0}</span></div>
                    </div>

                    <div className="section-title" style={{ marginTop: '10px', marginBottom: '-5px' }}>Raw Traces Window</div>
                    <div id="eeg-canvas-wrapper">
                        <canvas ref={eegCanvasRef} id="eeg-waves-canvas"></canvas>
                    </div>
                </div>

                <div id="visualization-split" className={is3dVisible ? '' : 'hide-3d'}>
                    <div className="interactive-panel vis-panel" id="panel-2d">
                        <div className="canvas-wrapper">
                            <canvas ref={canvas2dRef} id="topoplot-2d-canvas"></canvas>
                        </div>
                    </div>
                    <div className="interactive-panel vis-panel" id="panel-3d">
                        <div ref={container3dRef} className="canvas-wrapper" id="canvas-3d-container">
                            <div id="labels-container"></div>
                            <div id="tooltip-3d">
                                <h4 id="tooltip-title">Electrode</h4>
                                <p>Power: <span id="tooltip-value">0.00</span> µV²/Hz</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="interactive-panel timeline-panel">
                    <div className="timeline-row">
                        <div className="slider-container">
                            <input type="range" className="timeline-slider" min="0" max={maxTime} value={currentTime} step="0.01" onChange={handleTimeSliderChange} />
                        </div>
                        <div className="time-display">{timeText}</div>
                    </div>
                    <div className="playback-controls">
                        <div className="control-btns">
                            <button onClick={() => setCurrentTime(prev => Math.max(0, prev - 1))} className="scrub-btn">⏮</button>
                            <button onClick={handlePlayPause} className="play-pause-btn">{isPlaying ? '⏸' : '▶'}</button>
                            <button onClick={() => setCurrentTime(prev => Math.min(maxTime, prev + 1))} className="scrub-btn">⏭</button>
                        </div>
                        <div className="speed-control">
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>SPEED:</span>
                            {[0.25, 0.5, 1.0, 2.0].map(s => (
                                <button key={s} onClick={() => handleSpeedChange(s)} className={`speed-btn ${playbackSpeed === s ? 'active' : ''}`}>{s.toFixed(2)}x</button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- MAIN APP COMPONENT ---
const App = () => {
    const [token, setToken] = useState(getCookie('jwt-token') || '');
    const [currentPath, setCurrentPath] = useState(window.location.pathname);
    const [selectedPatient, setSelectedPatient] = useState(null);
    const [selectedFile, setSelectedFile] = useState(null);

    useEffect(() => {
        const handleRoute = () => {
            const path = window.location.pathname;
            setCurrentPath(path);

            if (!token && path !== '/login') {
                window.history.pushState({}, '', '/login');
                setCurrentPath('/login');
                return;
            }

            const viewerMatch = path.match(/^\/patient\/([^/]+)\/source_loc\/([^/]+)/);
            const detailsMatch = path.match(/^\/patient\/([^/]+)/);

            if (viewerMatch) {
                if (!selectedPatient) {
                    fetch(`/auth/patients?q=&department=-1`, { headers: { 'Authorization': `Bearer ${token}` } })
                        .then(res => res.json())
                        .then(data => {
                            const p = data.data?.patients.find(x => x.id === viewerMatch[1]);
                            if (p) setSelectedPatient(p);
                        });
                }
                if (!selectedFile) {
                    fetch(`/files/file?patient_id=${encodeURIComponent(viewerMatch[1])}`, { headers: { 'Authorization': `Bearer ${token}` } })
                        .then(res => res.json())
                        .then(data => {
                            const f = data.data.find(x => x.id === viewerMatch[2]);
                            if (f) setSelectedFile(f);
                        });
                }
            } else if (detailsMatch) {
                if (!selectedPatient) {
                    fetch(`/auth/patients?q=&department=-1`, { headers: { 'Authorization': `Bearer ${token}` } })
                        .then(res => res.json())
                        .then(data => {
                            const p = data.data?.patients.find(x => x.id === detailsMatch[1]);
                            if (p) setSelectedPatient(p);
                        });
                }
            }
        };

        window.addEventListener('popstate', handleRoute);
        handleRoute();
        return () => window.removeEventListener('popstate', handleRoute);
    }, [token]);

    const navigate = (path) => {
        window.history.pushState({}, '', path);
        setCurrentPath(path);
    };

    const handleLogin = (tok) => {
        setToken(tok);
        navigate('/files');
    };

    const handleLogout = () => {
        deleteCookie('jwt-token');
        setToken('');
        setSelectedPatient(null);
        setSelectedFile(null);
        navigate('/login');
    };

    const handleSelectPatient = (p) => {
        setSelectedPatient(p);
        navigate(`/patient/${p.id}`);
    };

    const handleSelectFile = (f) => {
        setSelectedFile(f);
        navigate(`/patient/${selectedPatient.id}/source_loc/${f.id}`);
    };

    // Router views
    if (!token) {
        return <LoginView onLogin={handleLogin} />;
    }

    if (currentPath === '/login') {
        navigate('/files');
        return null;
    }

    if (currentPath === '/files' || currentPath === '/') {
        return <DashboardView token={token} onLogout={handleLogout} onSelectPatient={handleSelectPatient} />;
    }

    const viewerMatch = currentPath.match(/^\/patient\/([^/]+)\/source_loc\/([^/]+)/);
    const detailsMatch = currentPath.match(/^\/patient\/([^/]+)/);

    if (viewerMatch && selectedPatient && selectedFile) {
        return <VisualizerView selectedPatient={selectedPatient} selectedFile={selectedFile} token={token} onBack={() => navigate(`/patient/${selectedPatient.id}`)} />;
    }

    if (detailsMatch && selectedPatient) {
        return <PatientDetailsView patient={selectedPatient} token={token} onBack={() => navigate('/files')} onSelectFile={handleSelectFile} />;
    }

    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f8fafc' }}>
            <p style={{ color: '#64748b' }}>Establishing link to Avinya telemetry nodes...</p>
        </div>
    );
};

export default App;
