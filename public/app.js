const socket = io();

let currentUser = null;
let currentToken = null;
let currentEmergencyId = null;
let demoLocations = {};

// DOM Elements
const views = {
    auth: document.getElementById("view-auth"),
    dashboard: document.getElementById("view-dashboard"),
    circle: document.getElementById("view-circle"),
    scan: document.getElementById("view-scan"),
    contacts: document.getElementById("view-contacts"),
    notifications: document.getElementById("view-notifications"),
    admin: document.getElementById("view-admin"),
    history: document.getElementById("view-history")
};

let html5QrcodeScanner = null;

function switchTab(tabName) {
    // Hide all
    Object.values(views).forEach(v => {
        if (v) {
            v.classList.add("hidden");
            v.classList.remove("block");
        }
    });
    // Show target
    if(views[tabName]) {
        views[tabName].classList.remove("hidden");
        views[tabName].classList.add("block");
    }
    
    // Update nav styling
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active-nav');
        if (btn.dataset.target === tabName) {
            btn.classList.add('active-nav');
        }
    });

    if (tabName === 'circle') loadSafetyCircle();
    if (tabName === 'history' && views.history) loadHistory();
    
    // QR Scanner Initialization
    if (tabName === 'scan') {
        if (!html5QrcodeScanner) {
            html5QrcodeScanner = new Html5QrcodeScanner(
                "reader",
                { fps: 10, qrbox: {width: 250, height: 250} },
                /* verbose= */ false
            );
            html5QrcodeScanner.render(onScanSuccess, onScanFailure);
        }
    } else {
        // Clear scanner if navigating away
        if (html5QrcodeScanner) {
            try {
                html5QrcodeScanner.clear();
                html5QrcodeScanner = null;
            } catch(e) {}
        }
    }
}

async function onScanSuccess(decodedText, decodedResult) {
    if(html5QrcodeScanner) {
        html5QrcodeScanner.clear();
        html5QrcodeScanner = null;
    }
    
    // The decoded text should be the token
    const token = decodedText.trim();
    document.getElementById("manual-token").value = token;
    await manualConnect();
}

function onScanFailure(error) {
    // handle scan failure, usually better to ignore and keep scanning
}

function showModals(id) {
    document.querySelectorAll("[id^=modal-]").forEach(m => m.classList.add("hidden"));
    if(id) document.getElementById(id).classList.remove("hidden");
}
function closeModals() { showModals(null); }

// API Helper
async function api(path, method = "GET", body = null) {
    const headers = { "Content-Type": "application/json" };
    if (currentToken) headers["Authorization"] = `Bearer ${currentToken}`;
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : null });
    return res.json();
}

// Dark Mode Logic
function toggleDarkMode() {
    const htmlEl = document.documentElement;
    if (htmlEl.classList.contains('dark')) {
        htmlEl.classList.remove('dark');
        localStorage.setItem('theme', 'light');
        document.getElementById('theme-icon').innerText = '🌙';
    } else {
        htmlEl.classList.add('dark');
        localStorage.setItem('theme', 'dark');
        document.getElementById('theme-icon').innerText = '☀️';
    }
}
// Init theme
if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
    const ti = document.getElementById('theme-icon');
    if(ti) ti.innerText = '☀️';
} else {
    document.documentElement.classList.remove('dark');
}

let isSignUpMode = false;

function toggleAuthMode() {
    isSignUpMode = !isSignUpMode;
    const nameInput = document.getElementById("auth-name");
    const title = document.getElementById("auth-title");
    const btnAction = document.getElementById("btn-auth-action");
    const toggleText = document.getElementById("auth-toggle-text");
    
    if (isSignUpMode) {
        nameInput.classList.remove("hidden");
        title.innerText = "Create Account";
        btnAction.innerText = "Sign Up";
        toggleText.innerText = "Already have an account? Sign In";
    } else {
        nameInput.classList.add("hidden");
        title.innerText = "Welcome";
        btnAction.innerText = "Sign In";
        toggleText.innerText = "Need an account? Sign Up";
    }
}

function fillAuth(email) {
    if(isSignUpMode) toggleAuthMode();
    document.getElementById("auth-email").value = email;
    document.getElementById("auth-password").value = "password";
}

async function handleAuth() {
    const email = document.getElementById("auth-email").value;
    const password = document.getElementById("auth-password").value;
    
    if (isSignUpMode) {
        const name = document.getElementById("auth-name").value || email.split("@")[0];
        const res = await api("/api/auth/register", "POST", { name, email, password });
        if (res.id) {
            alert("Account created successfully! Logging you in...");
            toggleAuthMode();
            await login(email, password);
        } else {
            alert(res.error || "Registration failed");
        }
    } else {
        await login(email, password);
    }
}

// Auth
async function login(providedEmail, providedPassword) {
    const email = providedEmail || document.getElementById("auth-email").value;
    const password = providedPassword || document.getElementById("auth-password").value;
    const res = await api("/api/auth/login", "POST", { email, password });
    if (res.token) {
        currentToken = res.token;
        currentUser = res.user;
        
        socket.emit("authenticate", currentToken);
        
        document.getElementById("nav-user").classList.remove("hidden");
        document.getElementById("nav-user").classList.add("block");
        document.getElementById("dashboard-greeting").innerText = `Hi, ${currentUser.name}`;
        document.getElementById("bottom-nav").classList.remove("hidden");
        
        switchTab("dashboard");
    } else {
        alert(res.error || "Invalid credentials");
    }
}

function logout() {
    currentToken = null; 
    currentUser = null;
    
    // Hide Logout Button
    document.getElementById("nav-user").classList.add("hidden");
    document.getElementById("nav-user").classList.remove("block");
    
    // Hide Bottom Nav
    document.getElementById("bottom-nav").classList.add("hidden");
    
    // Show Login Screen
    switchTab("auth");
}

async function setupDemo() {
    const res = await api("/api/demo/setup", "POST");
    demoLocations = res.demoLocations || {};
    alert("Demo users initialized!");
}

// QR & Circle
async function loadSafetyCircle() {
    const circle = await api("/api/safety/circle");
    const list = document.getElementById("circle-list");
    const count = document.getElementById("circle-count");
    if (circle.length === 0) {
        list.innerHTML = `<li class="text-center font-bold text-slate-400 py-8">No connections yet. Connect to someone's QR!</li>`;
        if (count) count.innerText = "0";
        return;
    }
    list.innerHTML = circle.map(c => `
        <li class="flex justify-between items-center bg-white p-4 rounded-xl border-2 border-slate-200">
            <div class="flex items-center gap-4">
                <div class="w-12 h-12 bg-navy-900 text-white rounded-xl flex items-center justify-center font-black text-xl shadow-inner">${c.name.charAt(0)}</div>
                <div>
                    <div class="font-black text-navy-900 text-lg leading-tight">${c.name}</div>
                    <div class="text-xs font-bold text-slate-500">${c.phone}</div>
                </div>
            </div>
            <div class="bg-green-100 text-green-700 text-[10px] uppercase font-black px-3 py-1 rounded-md border-2 border-green-200">
                Connected
            </div>
        </li>
    `).join("");
    if (count) count.innerText = circle.length;
}

function showQR() {
    if(!currentUser) {
        alert("Not logged in");
        return;
    }
    const container = document.getElementById("qr-container");
    container.innerHTML = "";
    
    const tokenToGenerate = currentUser.qr_token || "error_no_token";
    
    try {
        new QRCode(container, {
            text: tokenToGenerate,
            width: 180, height: 180,
            colorDark : "#0f172a",
            colorLight : "#f8fafc"
        });
    } catch (err) {
        console.error("QR Gen Error:", err);
        container.innerHTML = "<div class='p-4 bg-red-100 text-red-600 rounded'>Failed to render QR image</div>";
    }
    
    document.getElementById("qr-token-text").innerText = tokenToGenerate;
    showModals("modal-qr");
}

function copyToken() {
    if(currentUser && currentUser.qr_token) {
        navigator.clipboard.writeText(currentUser.qr_token);
        alert("Token copied to clipboard: " + currentUser.qr_token);
    }
}

async function manualConnect() {
    const token = document.getElementById("manual-token").value.trim();
    if(!token) return alert("Please enter a token in the box first.");
    
    try {
        const res = await api("/api/safety/connect", "POST", { token });
        if (res.success) {
            alert("Successfully connected to Trusted User!");
            document.getElementById("manual-token").value = "";
            switchTab("circle");
        } else {
            alert(res.error || "Failed to connect. Check the token.");
        }
    } catch (e) {
        alert("Network error while trying to connect.");
    }
}

// Quick Demo Connect for SIH
async function demoQuickConnect() {
    // If I am Om, connect to Rahul's token. If Rahul, connect to Om's token.
    const targetToken = currentUser.email === "om@demo.com" ? "token_rahul_123" : "token_om_123";
    document.getElementById("manual-token").value = targetToken;
    await manualConnect();
}

// History
async function loadHistory() {
    const history = await api("/api/emergency/history");
    const list = document.getElementById("history-list");
    if(history.length === 0) {
        list.innerHTML = `<li class="text-center font-bold text-slate-400 py-8">No past emergencies.</li>`;
        return;
    }
    
    list.innerHTML = history.map(h => `
        <li class="bg-white p-4 rounded-xl border-2 border-slate-200">
            <div class="flex justify-between items-center mb-2">
                <span class="font-black ${h.status === 'ACTIVE' ? 'text-alert-600' : 'text-slate-700'}">${h.status}</span>
                <span class="text-xs font-bold text-slate-400">${new Date(h.created_at).toLocaleString()}</span>
            </div>
        </li>
    `).join("");
}

// SOS Logic (3 Second Hold)
const btnSos = document.getElementById("btn-sos");
const progressCircle = document.getElementById("sos-progress");
const sosStatusText = document.getElementById("sos-status-text");

let holdTimer = null;
let startTime = 0;
const HOLD_DURATION = 3000; 

function resetSOSUI() {
    progressCircle.style.strokeDashoffset = "289";
    btnSos.style.transform = "scale(1)";
    sosStatusText.innerText = "Hold for 3 seconds";
    sosStatusText.classList.remove("bg-alert-100", "text-alert-700", "border-alert-600");
}

function updateProgress(timestamp) {
    if (!startTime) startTime = timestamp;
    const elapsed = timestamp - startTime;
    const progress = Math.min(elapsed / HOLD_DURATION, 1);
    
    // update circle (289 is max dashoffset)
    progressCircle.style.strokeDashoffset = 289 - (289 * progress);
    
    if (progress < 1) {
        holdTimer = requestAnimationFrame(updateProgress);
    } else {
        // Trigger
        triggerSOS();
    }
}

function startSOSHold(e) {
    if(e) e.preventDefault();
    if(currentEmergencyId) return; // Already active
    
    btnSos.style.transform = "scale(0.95)";
    sosStatusText.innerText = "Holding...";
    sosStatusText.classList.add("bg-alert-100", "text-alert-700", "border-alert-600");
    
    startTime = performance.now();
    holdTimer = requestAnimationFrame(updateProgress);
}

function stopSOSHold(e) {
    if(e) e.preventDefault();
    if (holdTimer) cancelAnimationFrame(holdTimer);
    resetSOSUI();
}

btnSos.addEventListener("mousedown", startSOSHold);
btnSos.addEventListener("touchstart", startSOSHold);
btnSos.addEventListener("mouseup", stopSOSHold);
btnSos.addEventListener("mouseleave", stopSOSHold);
btnSos.addEventListener("touchend", stopSOSHold);


async function triggerSOS() {
    if(holdTimer) cancelAnimationFrame(holdTimer);
    resetSOSUI();
    
    btnSos.classList.add("opacity-50", "pointer-events-none");
    sosStatusText.innerText = "Transmitting SOS...";
    
    // Get demo location based on user ID if available
    let lat = 18.5204;
    let lon = 73.8567;
    if(currentUser && demoLocations[currentUser.id]) {
        lat = demoLocations[currentUser.id].lat;
        lon = demoLocations[currentUser.id].lon;
    }
    
    const res = await api("/api/emergency/sos", "POST", { latitude: lat, longitude: lon });
    if (res.id) {
        currentEmergencyId = res.id;
        document.getElementById("victim-emergency-status").classList.remove("hidden");
        document.getElementById("victim-updates-list").innerHTML = `<li><span class="text-xs text-slate-500 mr-2">${new Date().toLocaleTimeString()}</span><span class="font-bold">SOS Activated. Alerts sent privately to connected circle.</span></li>`;
        
        // Play subtle confirmation sound for the victim
        try {
            const victimAudio = new Audio("https://actions.google.com/sounds/v1/ui/button_click.ogg");
            victimAudio.play();
        } catch (e) {
            console.log("Audio blocked by browser");
        }
    }
    
    btnSos.classList.remove("opacity-50", "pointer-events-none");
}

async function resolveEmergency() {
    if(!currentEmergencyId) return;
    const res = await api(`/api/emergency/${currentEmergencyId}/respond`, "POST", { action: "RESOLVED" });
    document.getElementById("victim-emergency-status").classList.add("hidden");
    currentEmergencyId = null;
    alert("Emergency Resolved.");
}


// Socket real-time (Responder side)
let alarmAudio = null;

socket.on("sos-created", (emergency) => {
    currentEmergencyId = emergency.id;
    document.getElementById("sos-victim-name").innerText = `${emergency.userName} needs help!`;
    document.getElementById("sos-time").innerText = new Date(emergency.time).toLocaleTimeString();
    
    // Calculate distance if we are a demo responder with a location
    let distStr = "Unknown";
    if (currentUser && demoLocations[currentUser.id]) {
        const rLoc = demoLocations[currentUser.id];
        // simple haversine in client to show distance immediately
        const distKm = haversineDistance(emergency.latitude, emergency.longitude, rLoc.lat, rLoc.lon);
        distStr = distKm < 1 ? Math.round(distKm*1000) + " m" : distKm.toFixed(1) + " km";
    }
    document.getElementById("sos-distance").innerText = distStr;
    
    document.getElementById("responder-actions").innerHTML = `
        <button onclick="respondToSOS('ACCEPTED')" class="w-full bg-green-600 text-white font-black py-5 rounded-xl text-xl shadow-lg active:scale-95 transition-transform">I CAN HELP</button>
        <div class="flex gap-3">
            <button onclick="closeModals(); stopAlarm();" class="flex-1 bg-white dark:bg-slate-800 border-4 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 font-black py-3 rounded-xl">DECLINE</button>
        </div>
    `;
    
    // Play loud alarm for the responder
    try {
        if(alarmAudio) alarmAudio.pause();
        alarmAudio = new Audio("https://actions.google.com/sounds/v1/alarms/digital_watch_alarm_long.ogg");
        alarmAudio.loop = true;
        alarmAudio.play();
    } catch (e) {
        console.log("Alarm audio blocked by browser");
    }

    showModals("modal-emergency");
});

function stopAlarm() {
    if(alarmAudio) {
        alarmAudio.pause();
        alarmAudio.currentTime = 0;
    }
}

async function respondToSOS(status) {
    if(!currentEmergencyId) return;
    
    // Stop the loud alarm when they respond
    stopAlarm();
    
    // Pass our demo location back to server to calculate distance for the victim
    let lat = null, lon = null;
    if(currentUser && demoLocations[currentUser.id]) {
        lat = demoLocations[currentUser.id].lat;
        lon = demoLocations[currentUser.id].lon;
    }
    
    const res = await api(`/api/emergency/${currentEmergencyId}/respond`, "POST", { action: status, responderLat: lat, responderLon: lon });
    
    const actionsDiv = document.getElementById("responder-actions");
    if (status === "ACCEPTED") {
        actionsDiv.innerHTML = `<button onclick="respondToSOS('ON_WAY')" class="w-full bg-accent-600 text-white font-black py-5 rounded-xl text-xl shadow-lg">I'M ON THE WAY</button>`;
    } else if (status === "ON_WAY") {
        actionsDiv.innerHTML = `<button onclick="respondToSOS('REACHED')" class="w-full bg-navy-900 text-white font-black py-5 rounded-xl text-xl shadow-lg">I'VE REACHED</button>`;
    } else if (status === "REACHED") {
        closeModals();
        alert("Status updated: Reached location. The victim can now resolve the emergency.");
    }
}

// Socket real-time (Victim side)
socket.on("emergency-updated", (data) => {
    if (currentEmergencyId == data.emergencyId && !document.getElementById("victim-emergency-status").classList.contains("hidden")) {
        let msg = "";
        
        let distMsg = "";
        if(data.distance != null) {
            distMsg = data.distance < 1 ? ` (${Math.round(data.distance*1000)}m away)` : ` (${data.distance.toFixed(1)}km away)`;
        }
        
        if (data.status === "RESPONDER_ACCEPTED") msg = `✅ ${data.responderName} is responding${distMsg}.`;
        if (data.status === "RESPONDER_ON_WAY") msg = `🚗 ${data.responderName} is on the way.`;
        if (data.status === "RESPONDER_REACHED") msg = `📍 ${data.responderName} has reached your location.`;
        if (data.status === "RESOLVED") {
             msg = `✅ Emergency resolved.`;
             document.getElementById("victim-emergency-status").classList.add("hidden");
             currentEmergencyId = null;
        }
        
        if(msg) {
            document.getElementById("victim-updates-list").innerHTML = `<li><span class="text-xs text-slate-500 mr-2">${new Date().toLocaleTimeString()}</span><span class="font-bold">${msg}</span></li>` + document.getElementById("victim-updates-list").innerHTML;
        }
    }
});

// Haversine JS implementation for client side initial calc
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}
