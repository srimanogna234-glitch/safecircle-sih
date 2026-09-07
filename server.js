const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const db = require("./db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const SECRET = "safecircle_secret_key_123";

// Map to store connected socket IDs for real-time private messaging
const connectedSockets = new Map();

io.on("connection", (socket) => {
    socket.on("authenticate", (token) => {
        try {
            const user = jwt.verify(token, SECRET);
            socket.userId = user.id;
            socket.join(`user_${user.id}`);
            connectedSockets.set(user.id, socket.id);
            console.log(`User ${user.id} authenticated on socket ${socket.id}`);
        } catch (e) {
            console.log("Socket auth failed");
        }
    });

    socket.on("disconnect", () => {
        if (socket.userId) {
            connectedSockets.delete(socket.userId);
        }
    });
});

// Basic Auth Middleware
const auth = (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({error: "No token"});
    try {
        req.user = jwt.verify(token, SECRET);
        next();
    } catch (e) {
        res.status(401).json({error: "Invalid token"});
    }
};

// Helper function to calculate distance
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// API: Register
app.post("/api/auth/register", (req, res) => {
    const { name, email, phone, password, role } = req.body;
    const hash = bcrypt.hashSync(password, 8);
    const qr_token = crypto.randomBytes(16).toString("hex");
    
    db.run(`INSERT INTO users (name, email, phone, password_hash, role, qr_token) VALUES (?, ?, ?, ?, ?, ?)`,
        [name, email, phone, hash, role || "USER", qr_token],
        function(err) {
            if (err) return res.status(400).json({error: err.message});
            res.json({ id: this.lastID, name, email, qr_token });
        }
    );
});

// API: Login
app.post("/api/auth/login", (req, res) => {
    const { email, password } = req.body;
    db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, user) => {
        if (err || !user) return res.status(401).json({error: "Invalid credentials"});
        if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({error: "Invalid credentials"});
        const token = jwt.sign({id: user.id, name: user.name, role: user.role}, SECRET);
        res.json({ token, user: {id: user.id, name: user.name, role: user.role, qr_token: user.qr_token} });
    });
});

// API: Setup Demo Users
app.post("/api/demo/setup", (req, res) => {
    const users = [
        ["Om", "om@demo.com", "1234", bcrypt.hashSync("password", 8), "USER", "token_om_123"],
        ["Rahul", "rahul@demo.com", "2345", bcrypt.hashSync("password", 8), "RESPONDER", "token_rahul_123"],
        ["Priya", "priya@demo.com", "3456", bcrypt.hashSync("password", 8), "USER", "token_priya_123"],
        ["Maya", "maya@demo.com", "4567", bcrypt.hashSync("password", 8), "PARENT", "token_maya_123"]
    ];
    
    // Hardcode locations for demo (Pune area approx)
    const demoLocations = {
        1: { lat: 18.5204, lon: 73.8567 }, // Om (Victim)
        2: { lat: 18.5254, lon: 73.8617 }, // Rahul (~700m away)
        3: { lat: 18.5500, lon: 73.8900 }  // Priya (~4km away)
    };
    
    db.serialize(() => {
        users.forEach(u => {
            db.run(`INSERT OR IGNORE INTO users (name, email, phone, password_hash, role, qr_token) VALUES (?, ?, ?, ?, ?, ?)`, u);
        });
        
        // Also pre-connect Om and Rahul for the demo
        db.run(`INSERT OR IGNORE INTO safety_connections (user_id, connected_user_id, status) VALUES (1, 2, 'CONNECTED')`);
        db.run(`INSERT OR IGNORE INTO safety_connections (user_id, connected_user_id, status) VALUES (2, 1, 'CONNECTED')`);
        
        res.json({success: true, message: "Demo users ready", demoLocations});
    });
});

// API: QR Connection (Using token)
app.post("/api/safety/connect", auth, (req, res) => {
    const { token } = req.body;
    db.get(`SELECT id FROM users WHERE qr_token = ?`, [token], (err, targetUser) => {
        if (err || !targetUser) return res.status(404).json({error: "Invalid QR Token"});
        if (targetUser.id === req.user.id) return res.status(400).json({error: "Cannot connect to yourself"});
        
        db.run(`INSERT INTO safety_connections (user_id, connected_user_id, status) VALUES (?, ?, ?)`,
            [req.user.id, targetUser.id, "CONNECTED"],
            function(err) {
                // reciprocal connection for MVP
                db.run(`INSERT INTO safety_connections (user_id, connected_user_id, status) VALUES (?, ?, ?)`,
                    [targetUser.id, req.user.id, "CONNECTED"]);
                res.json({success: true});
            }
        );
    });
});

// API: Get Safety Circle
app.get("/api/safety/circle", auth, (req, res) => {
    db.all(`SELECT u.id, u.name, u.phone, sc.status FROM safety_connections sc JOIN users u ON sc.connected_user_id = u.id WHERE sc.user_id = ?`,
        [req.user.id], (err, rows) => {
            res.json(rows || []);
        });
});

// API: Get Profile
app.get("/api/auth/me", auth, (req, res) => {
    db.get(`SELECT id, name, email, phone, role, qr_token FROM users WHERE id = ?`, [req.user.id], (err, user) => {
        if (err || !user) return res.status(404).json({error: "Not found"});
        res.json(user);
    });
});


// API: Trigger SOS
app.post("/api/emergency/sos", auth, (req, res) => {
    const { latitude, longitude } = req.body;
    db.run(`INSERT INTO emergencies (user_id, latitude, longitude, status) VALUES (?, ?, ?, ?)`,
        [req.user.id, latitude, longitude, "ACTIVE"],
        function(err) {
            if (err) return res.status(500).json({error: err.message});
            const emergencyId = this.lastID;
            const emergency = { id: emergencyId, userId: req.user.id, userName: req.user.name, latitude, longitude, status: "ACTIVE", time: new Date() };
            
            // Log event
            db.run(`INSERT INTO emergency_events (emergency_id, event_type, description) VALUES (?, ?, ?)`,
                [emergencyId, "CREATED", "SOS Activated by user"]);
            
            // ONLY NOTIFY CONNECTED TRUSTED USERS
            db.all(`SELECT connected_user_id FROM safety_connections WHERE user_id = ? AND status = 'CONNECTED'`, [req.user.id], (err, rows) => {
                if (!err && rows) {
                    rows.forEach(row => {
                        const targetSocketRoom = `user_${row.connected_user_id}`;
                        // We emit directly to the user's room
                        io.to(targetSocketRoom).emit("sos-created", emergency);
                    });
                }
            });
            
            res.json(emergency);
        }
    );
});

// API: Response Actions
app.post("/api/emergency/:id/respond", auth, (req, res) => {
    const { id } = req.params;
    const { action, responderLat, responderLon } = req.body; // ACCEPT, ON_WAY, REACHED, RESOLVED
    
    db.get(`SELECT * FROM emergencies WHERE id = ?`, [id], (err, emergency) => {
        if (err || !emergency) return res.status(404).json({error: "Emergency not found"});
        
        let newStatus = action;
        let eventDesc = "";
        if (action === "ACCEPTED") { newStatus = "RESPONDER_ACCEPTED"; eventDesc = `${req.user.name} accepted the emergency.`; }
        if (action === "ON_WAY") { newStatus = "RESPONDER_ON_WAY"; eventDesc = `${req.user.name} is on the way.`; }
        if (action === "REACHED") { newStatus = "RESPONDER_REACHED"; eventDesc = `${req.user.name} has reached the location.`; }
        if (action === "RESOLVED") { newStatus = "RESOLVED"; eventDesc = `Emergency resolved by ${req.user.name}.`; }

        let dist = null;
        if(responderLat && responderLon && emergency.latitude && emergency.longitude) {
            dist = haversineDistance(emergency.latitude, emergency.longitude, responderLat, responderLon);
        }

        db.run(`UPDATE emergencies SET status = ? WHERE id = ?`, [newStatus, id], (err) => {
            db.run(`INSERT INTO emergency_events (emergency_id, event_type, description) VALUES (?, ?, ?)`,
                [id, newStatus, eventDesc]);
                
            // Notify the victim
            io.to(`user_${emergency.user_id}`).emit("emergency-updated", { 
                emergencyId: id, 
                status: newStatus, 
                responderName: req.user.name,
                distance: dist
            });
            
            res.json({success: true, status: newStatus});
        });
    });
});

// API: Get History
app.get("/api/emergency/history", auth, (req, res) => {
    db.all(`SELECT * FROM emergencies WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`, [req.user.id], (err, rows) => {
        res.json(rows || []);
    });
});


const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`SafeCircle MVP running on http://localhost:${PORT}`);
});
