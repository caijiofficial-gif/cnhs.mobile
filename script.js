import { initializeApp }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, onSnapshot, doc, deleteDoc, updateDoc, addDoc, serverTimestamp }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
// FIX: import anonymous auth so Firebase lets us read/write Firestore
import { getAuth, signInAnonymously, onAuthStateChanged }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ── FIREBASE CONFIG ────────────────────────────────────────────────
const firebaseConfig = {
    apiKey:            "AIzaSyAJZ1dibYjK9_SWVrdPl4NWiHPXNS1bz5Y",
    authDomain:        "cnhs-student-files.firebaseapp.com",
    projectId:         "cnhs-student-files",
    storageBucket:     "cnhs-student-files.appspot.com",
    messagingSenderId: "1065212176778",
    appId:             "1:1065212176778:web:45746a21168cea1e1a0073"
};

const ADMIN_USER = "ADMIN OFFICE";
const ADMIN_PASS = "admin123";

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

// ── STATE ──────────────────────────────────────────────────────────
let allStudents  = [];
let allSchedules = [];
let currentStrand = "all";
let currentStatus = "all";
let schedFilter   = "all";
let deleteTargetId  = null;
let deleteSchedId   = null;
let editSchedId     = null;
let unsubEnroll     = null;
let unsubSched      = null;
let isFirebaseReady = false;

// ── FIX: Sign in anonymously as soon as the page loads ─────────────
// This gives the browser an authenticated identity so Firestore
// Security Rules can allow reads/writes via: allow read, write: if request.auth != null;
signInAnonymously(auth).catch(err => {
    console.warn("Anonymous sign-in failed:", err.message);
    // Non-fatal: listeners will still try; open rules will still work
});

onAuthStateChanged(auth, user => {
    isFirebaseReady = true;
    console.log("Firebase auth state:", user ? "signed in (anonymous: " + user.isAnonymous + ")" : "not signed in");
});

// ── LOGIN ──────────────────────────────────────────────────────────
window.loginAdmin = function () {
    const u = document.getElementById("adminUser").value.trim();
    const p = document.getElementById("adminPass").value;

    if (u === ADMIN_USER && p === ADMIN_PASS) {
        document.getElementById("loginPage").style.display = "none";
        document.getElementById("dashPage").style.display  = "block";
        startEnrollListener();
        startSchedListener();
    } else {
        const card = document.querySelector(".login-card");
        card.style.animation = "none";
        card.offsetHeight;
        card.style.animation = "shake 0.4s ease";
        setTimeout(() => card.style.animation = "", 500);
        alert("❌ Invalid credentials.");
    }
};

window.logoutAdmin = function () {
    if (unsubEnroll) unsubEnroll();
    if (unsubSched)  unsubSched();
    location.reload();
};

// ── ENROLLMENT LISTENER ────────────────────────────────────────────
// FIX: retry logic if Firebase isn't authenticated yet when listener starts
function startEnrollListener() {
    const tryListen = () => {
        unsubEnroll = onSnapshot(
            collection(db, "enrollments"),
            snapshot => {
                const prevIds = new Set(allStudents.map(s => s.id));
                allStudents = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

                snapshot.docChanges().forEach(change => {
                    const s = { id: change.doc.id, ...change.doc.data() };
                    if (change.type === "added"   && prevIds.size > 0) pushFeed(s, "new");
                    if (change.type === "removed")                     pushFeed(s, "deleted");
                });

                updateSidebar();
                if (document.getElementById("page-students").style.display !== "none") {
                    renderTable();
                }
                refreshStudentDatalist();
            },
            err => {
                console.error("Firestore error:", err.code, err.message);
                if (err.code === "permission-denied") {
                    alert(
                        "⚠️ Firebase permission denied.\n\n" +
                        "You need to update your Firestore Security Rules.\n\n" +
                        "Go to: Firebase Console → Firestore → Rules\n\n" +
                        "Paste this and click Publish:\n\n" +
                        "rules_version = '2';\n" +
                        "service cloud.firestore {\n" +
                        "  match /databases/{database}/documents {\n" +
                        "    match /{document=**} {\n" +
                        "      allow read, write: if request.auth != null;\n" +
                        "    }\n" +
                        "  }\n" +
                        "}\n\n" +
                        "Also enable Anonymous Authentication:\n" +
                        "Firebase Console → Authentication → Sign-in method → Anonymous → Enable"
                    );
                } else {
                    alert("⚠️ Database error: " + err.message);
                }
            }
        );
    };

    // If auth is ready immediately, start now; otherwise wait 1s for sign-in
    if (isFirebaseReady) {
        tryListen();
    } else {
        setTimeout(tryListen, 1000);
    }
}

// ── SCHEDULE LISTENER ──────────────────────────────────────────────
function startSchedListener() {
    const tryListen = () => {
        unsubSched = onSnapshot(
            collection(db, "interviews"),
            snapshot => {
                allSchedules = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                updateSchedSidebar();
                updateSchedSummary();
                if (document.getElementById("page-interviews").style.display !== "none") {
                    renderSchedTable();
                }
            },
            err => console.error("Interviews listener error:", err.message)
        );
    };

    if (isFirebaseReady) {
        tryListen();
    } else {
        setTimeout(tryListen, 1000);
    }
}

// ── PAGE NAVIGATION ────────────────────────────────────────────────
window.showPage = function (page) {
    ["page-overview", "page-students", "page-interviews"].forEach(id => {
        document.getElementById(id).style.display = "none";
    });
    document.getElementById("page-" + page).style.display = "block";

    document.querySelectorAll(".sidebar-item").forEach(el => el.classList.remove("active"));
    document.getElementById("nav-" + page)?.classList.add("active");

    if (page === "interviews") renderSchedTable();
};

window.setStrand = function (strand) {
    currentStrand = strand;
    currentStatus = "all";
    showPage("students");

    document.querySelectorAll(".sidebar-item").forEach(el => el.classList.remove("active"));
    const navId = strand === "all" ? "nav-all" : strand === "Home Economics" ? "nav-HE" : "nav-" + strand;
    document.getElementById(navId)?.classList.add("active");

    const titles = {
        all: "All Students",
        ABM: "ABM Students",
        ICT: "ICT Students",
        HUMSS: "HUMSS Students",
        "Home Economics": "Home Economics Students"
    };
    document.getElementById("tableTitle").textContent    = titles[strand] || strand;
    document.getElementById("tableSubtitle").textContent = strand === "all"
        ? "Showing all enrolled students"
        : `Filtered by ${strand} strand`;

    renderTable();
};

window.setStatus = function (status) {
    currentStatus = status;
    currentStrand = "all";
    showPage("students");

    document.querySelectorAll(".sidebar-item").forEach(el => el.classList.remove("active"));
    document.getElementById("nav-" + status)?.classList.add("active");

    document.getElementById("tableTitle").textContent    = status === "pending" ? "Pending Applications" : "Approved Students";
    document.getElementById("tableSubtitle").textContent = `Filtered by ${status} status`;

    renderTable();
};

// ── SIDEBAR COUNTS ─────────────────────────────────────────────────
function updateSidebar() {
    const c = { ABM: 0, ICT: 0, HUMSS: 0, "Home Economics": 0, pending: 0, approved: 0, rejected: 0 };
    allStudents.forEach(s => {
        const st = normalizeStrand(s.strand);
        if (c[st] !== undefined) c[st]++;
        const status = s.status || "pending";
        if (c[status] !== undefined) c[status]++;
    });

    const t = allStudents.length;
    document.getElementById("totalCount").textContent         = t;
    document.getElementById("abmCount").textContent           = c.ABM;
    document.getElementById("abmSub").textContent             = `${c.ABM} of 50 slots`;
    document.getElementById("abmBar").style.width             = Math.min((c.ABM / 50) * 100, 100) + "%";
    document.getElementById("ictCount").textContent           = c.ICT;
    document.getElementById("ictSub").textContent             = `${c.ICT} of 50 slots`;
    document.getElementById("ictBar").style.width             = Math.min((c.ICT / 50) * 100, 100) + "%";
    document.getElementById("humssCount").textContent         = c.HUMSS;
    document.getElementById("hmssSub").textContent            = `${c.HUMSS} of 50 slots`;
    document.getElementById("humssBar").style.width           = Math.min((c.HUMSS / 50) * 100, 100) + "%";
    document.getElementById("heCount").textContent            = c["Home Economics"];
    document.getElementById("heSub").textContent              = `${c["Home Economics"]} of 50 slots`;
    document.getElementById("heBar").style.width              = Math.min((c["Home Economics"] / 50) * 100, 100) + "%";

    document.getElementById("nav-count-all").textContent      = t;
    document.getElementById("nav-count-ABM").textContent      = c.ABM;
    document.getElementById("nav-count-ICT").textContent      = c.ICT;
    document.getElementById("nav-count-HUMSS").textContent    = c.HUMSS;
    document.getElementById("nav-count-HE").textContent       = c["Home Economics"];
    document.getElementById("nav-count-pending").textContent  = c.pending;
    document.getElementById("nav-count-approved").textContent = c.approved;

    document.getElementById("sumValABM").textContent   = c.ABM;
    document.getElementById("sumBarABM").style.width   = Math.min((c.ABM / 50) * 100, 100) + "%";
    document.getElementById("sumValICT").textContent   = c.ICT;
    document.getElementById("sumBarICT").style.width   = Math.min((c.ICT / 50) * 100, 100) + "%";
    document.getElementById("sumValHE").textContent    = c["Home Economics"];
    document.getElementById("sumBarHE").style.width    = Math.min((c["Home Economics"] / 50) * 100, 100) + "%";
    document.getElementById("sumValHUMSS").textContent = c.HUMSS;
    document.getElementById("sumBarHUMSS").style.width = Math.min((c.HUMSS / 50) * 100, 100) + "%";

    document.getElementById("sumPending").textContent  = c.pending;
    document.getElementById("sumApproved").textContent = c.approved;
    document.getElementById("sumRejected").textContent = c.rejected;
}

function updateSchedSidebar() {
    const pending = allSchedules.filter(s => s.status === "scheduled").length;
    document.getElementById("nav-count-interviews").textContent = pending || allSchedules.length;
}

function normalizeStrand(raw) {
    if (!raw) return "-";
    const s = raw.toLowerCase().trim();
    if (s.includes("abm"))              return "ABM";
    if (s.includes("humss"))            return "HUMSS";
    if (s.includes("ict"))              return "ICT";
    if (s.includes("home") || s === "he") return "Home Economics";
    return raw;
}

// ── RENDER STUDENTS TABLE ──────────────────────────────────────────
function renderTable() {
    const q     = (document.getElementById("tableSearch")?.value || "").toUpperCase();
    const tbody = document.getElementById("studentTableBody");
    tbody.innerHTML = "";

    let list = allStudents;
    if (currentStrand !== "all") list = list.filter(s => normalizeStrand(s.strand) === currentStrand);
    if (currentStatus !== "all") list = list.filter(s => (s.status || "pending") === currentStatus);
    if (q) list = list.filter(s =>
        (s.fullName || "").toUpperCase().includes(q) || (s.lrn || "").includes(q)
    );

    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="13"><div class="empty-state"><div class="empty-icon">🎓</div>No students found.</div></td></tr>`;
        return;
    }

    list.forEach(s => {
        const tr  = document.createElement("tr");
        const sub = s.submittedAt?.toDate
            ? s.submittedAt.toDate().toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })
            : (s.submittedAt || "—");

        const gmailDisplay = s.gmail
            ? `<a href="mailto:${s.gmail}" style="color:#60a5fa;font-size:12px;text-decoration:none;" title="${s.gmail}">${s.gmail}</a>`
            : `<span style="color:var(--text3);font-size:12px;">—</span>`;

        tr.innerHTML = `
            <td>${s.fullName || "—"}</td>
            <td>${s.age || "—"}</td>
            <td>${s.birthday || "—"}</td>
            <td>${s.gender || "—"}</td>
            <td style="font-family:monospace;font-size:12px;">${s.lrn || "—"}</td>
            <td>${s.gradeLevel || "—"}</td>
            <td><span class="badge" style="background:rgba(59,130,246,0.1);color:#93c5fd;border:1px solid rgba(59,130,246,0.2);">${normalizeStrand(s.strand)}</span></td>
            <td style="font-size:12px;color:var(--text3);">${s.refNumber || "—"}</td>
            <td>${gmailDisplay}</td>
            <td>${docCell(s.reportCard, "Report Card", s.id)}</td>
            <td>${docCell(s.form137,    "Form 137",    s.id)}</td>
            <td>${statusBadge(s.status)}</td>
            <td style="font-size:12px;color:var(--text3);">${sub}</td>
            <td class="no-print">
                <div class="action-btns">
                    ${(s.status || "pending") === "pending"
                        ? `<button class="btn-approve" onclick="approveStudent('${s.id}')">✓ Approve</button>
                           <button class="btn-reject"  onclick="updateStatus('${s.id}','rejected')">✕ Reject</button>`
                        : ""}
                    <button class="btn-del" onclick="openDeleteModal('${s.id}')">🗑</button>
                </div>
            </td>`;
        tbody.appendChild(tr);
    });
}

window.searchTable = function () { renderTable(); };

function statusBadge(status) {
    const s = status || "pending";
    if (s === "approved") return `<span class="badge badge-approved">✓ Approved</span>`;
    if (s === "rejected") return `<span class="badge badge-rejected">✕ Rejected</span>`;
    return `<span class="badge badge-pending">⏳ Pending</span>`;
}

function docCell(fileObj, label, studentId) {
    if (!fileObj?.url) return `<span class="doc-none">—</span>`;
    const key = `${studentId}_${label}`.replace(/[^a-zA-Z0-9_]/g, "_");
    window["__doc__" + key] = fileObj;
    if (fileObj.type?.startsWith("image/")) {
        return `<img class="doc-thumb" src="${fileObj.url}" alt="${label}"
                    onclick="openDocModal('${key}','${label}')" title="Click to preview">`;
    }
    return `<button class="doc-btn" onclick="openDocModal('${key}','${label}')">📄 View</button>`;
}

// ── EXPORT CSV ─────────────────────────────────────────────────────
window.exportCSV = function () {
    let list = allStudents;
    if (currentStrand !== "all") list = list.filter(s => normalizeStrand(s.strand) === currentStrand);
    if (currentStatus !== "all") list = list.filter(s => (s.status || "pending") === currentStatus);

    let csv = ["Name,Age,Birthday,Gender,LRN,Grade,Strand,Ref No.,Gmail,Status,Submitted"];
    list.forEach(s => {
        const sub = s.submittedAt?.toDate ? s.submittedAt.toDate().toLocaleString() : "";
        csv.push([s.fullName, s.age, s.birthday, s.gender, s.lrn,
                  s.gradeLevel, normalizeStrand(s.strand), s.refNumber, s.gmail || "", s.status || "pending", sub]
            .map(v => `"${(v || "").toString().replace(/"/g, '""')}"`).join(","));
    });

    const a    = document.createElement("a");
    a.href     = URL.createObjectURL(new Blob([csv.join("\n")], { type: "text/csv" }));
    a.download = `CNHS_Enrollment_${new Date().toLocaleDateString("en-PH").replace(/\//g, "-")}.csv`;
    a.click();
};

// ── EMAILJS CONFIG ─────────────────────────────────────────────────
// 1. Go to https://www.emailjs.com and sign up (free)
// 2. Add a Gmail service → copy the Service ID below
// 3. Create an Email Template → copy the Template ID below
// 4. Go to Account → copy your Public Key below
// In your EmailJS template use these variables:
//   {{to_email}}   — student's Gmail
//   {{to_name}}    — student's full name
//   {{ref_number}} — their reference number
//   {{strand}}     — their chosen strand
//   {{grade}}      — their grade level
const EMAILJS_SERVICE_ID  = "service_zuzvw5a";
const EMAILJS_TEMPLATE_ID = "template_yedos2g";
const EMAILJS_PUBLIC_KEY  = "lzrFnncpXU00qmvDb";

// ── APPROVE STUDENT (updates Firestore + sends approval email) ─────
window.approveStudent = async function (id) {
    const student = allStudents.find(s => s.id === id);
    if (!student) return;

    // Confirm before approving
    if (!confirm(`Approve ${student.fullName || "this student"}?\n\nAn acceptance email will be sent to:\n${student.gmail || "(no Gmail on file)"}`)) return;

    try {
        // 1. Update Firestore status to approved
        await updateDoc(doc(db, "enrollments", id), { status: "approved" });

        // 2. Send acceptance email via EmailJS (only if Gmail is on file)
        if (student.gmail) {
            const emailParams = {
                to_email:   student.gmail,
                to_name:    student.fullName   || "Student",
                ref_number: student.refNumber  || "—",
                strand:     student.strand     || "—",
                grade:      student.gradeLevel || "—",
            };

            // Load EmailJS SDK on first use
            if (!window.emailjs) {
                await new Promise((resolve, reject) => {
                    const script = document.createElement("script");
                    script.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
                emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
            }

            await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, emailParams);
            alert(`✅ ${student.fullName} has been approved!\n\nAcceptance email sent to:\n${student.gmail}`);
        } else {
            alert(`✅ ${student.fullName} has been approved!\n\n⚠️ No Gmail on file — no email was sent.`);
        }

    } catch (e) {
        console.error("Approve error:", e);
        // Status was already updated in Firestore — only email failed
        if (e?.text || e?.status) {
            alert(`✅ Approved in system, but email failed to send.\n\nEmailJS error: ${e.text || e.message}\n\nCheck your Service ID, Template ID, and Public Key in admin.js`);
        } else {
            alert("Failed to approve: " + e.message);
        }
    }
};

// ── UPDATE STATUS (used for reject and other status changes) ───────
window.updateStatus = async function (id, status) {
    try { await updateDoc(doc(db, "enrollments", id), { status }); }
    catch (e) { alert("Failed to update status: " + e.message); }
};

// ── DELETE ENROLLMENT ──────────────────────────────────────────────
window.openDeleteModal = function (id) {
    deleteTargetId = id;
    document.getElementById("confirmPassword").value = "";
    document.getElementById("deleteModal").classList.add("show");
};

window.confirmDelete = async function () {
    if (document.getElementById("confirmPassword").value !== ADMIN_PASS) {
        alert("❌ Wrong password"); return;
    }
    try {
        await deleteDoc(doc(db, "enrollments", deleteTargetId));
        closeModal("deleteModal");
    } catch (e) { alert("Delete failed: " + e.message); }
};

// ── MODALS ─────────────────────────────────────────────────────────
window.closeModal = function (id) {
    document.getElementById(id).classList.remove("show");
    if (id === "docModal") document.getElementById("docModalContent").innerHTML = "";
};

// ── DOCUMENT PREVIEW ───────────────────────────────────────────────
window.openDocModal = function (key, label) {
    const f = window["__doc__" + key];
    if (!f?.url) return;
    document.getElementById("docModalTitle").textContent = label;
    document.getElementById("docModalDownload").href     = f.url;
    document.getElementById("docModalDownload").download = f.name || label;
    const c = document.getElementById("docModalContent");
    if (f.type?.startsWith("image/")) {
        c.innerHTML = `<img src="${f.url}" style="max-width:100%;max-height:65vh;border-radius:12px;display:block;margin:0 auto;">`;
    } else if (f.type === "application/pdf") {
        c.innerHTML = `<iframe src="${f.url}" style="width:100%;height:65vh;border:none;border-radius:12px;"></iframe>`;
    } else {
        c.innerHTML = `<p style="color:var(--text3);text-align:center;padding:40px;">Preview unavailable — use Download.</p>`;
    }
    document.getElementById("docModal").classList.add("show");
};

// ── ACTIVITY FEED ──────────────────────────────────────────────────
function pushFeed(student, type) {
    const feed = document.getElementById("activityFeed");
    document.getElementById("feedEmpty")?.remove();

    const item = document.createElement("div");
    item.className = "feed-item";
    const time = new Date().toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
    item.innerHTML = type === "new"
        ? `<div class="feed-name"><span class="feed-badge-new">NEW</span>${student.fullName || "Unknown"}</div>
           <div class="feed-meta">${normalizeStrand(student.strand)} • ${student.gradeLevel || ""} • ${time}</div>`
        : `<div class="feed-name"><span class="feed-badge-del">DELETED</span><span style="color:var(--text3);">${student.fullName || "Unknown"}</span></div>
           <div class="feed-meta">${time}</div>`;

    feed.insertBefore(item, feed.firstChild);
    while (feed.children.length > 25) feed.removeChild(feed.lastChild);
}

// ── STUDENT DATALIST ───────────────────────────────────────────────
function refreshStudentDatalist() {
    const dl = document.getElementById("studentNamesList");
    if (!dl) return;
    dl.innerHTML = allStudents.map(s => `<option value="${s.fullName || ""}">`).join("");
}

// ══════════════════════════════════════════════
//   INTERVIEW SCHEDULES
// ══════════════════════════════════════════════

window.setSchedFilter = function (filter) {
    schedFilter = filter;
    document.querySelectorAll(".sched-filter-btn").forEach(b => b.classList.remove("active"));
    document.getElementById("sf-" + filter)?.classList.add("active");
    renderSchedTable();
};

function updateSchedSummary() {
    const total = allSchedules.length;
    const cnt   = { scheduled: 0, done: 0, cancelled: 0, rescheduled: 0, "no-show": 0 };
    allSchedules.forEach(s => { if (cnt[s.status] !== undefined) cnt[s.status]++; });

    document.getElementById("sched-total").textContent         = total;
    document.getElementById("sched-cnt-scheduled").textContent = cnt.scheduled;
    document.getElementById("sched-cnt-done").textContent      = cnt.done;
    document.getElementById("sched-cnt-cancelled").textContent = cnt.cancelled;
    document.getElementById("sched-cnt-no-show").textContent   = cnt["no-show"];
}

window.renderSchedTable = function () {
    const q     = (document.getElementById("schedSearch")?.value || "").toLowerCase();
    const tbody = document.getElementById("schedTableBody");
    tbody.innerHTML = "";

    let list = allSchedules;
    if (schedFilter !== "all") list = list.filter(s => s.status === schedFilter);
    if (q) list = list.filter(s =>
        (s.studentName || "").toLowerCase().includes(q) || (s.lrn || "").includes(q)
    );

    list.sort((a, b) => {
        const da  = a.date ? new Date(a.date + " " + (a.time || "")) : new Date(0);
        const db2 = b.date ? new Date(b.date + " " + (b.time || "")) : new Date(0);
        return da - db2;
    });

    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="11"><div class="empty-state"><div class="empty-icon">📅</div>No interview schedules found.</div></td></tr>`;
        return;
    }

    list.forEach(s => {
        const tr = document.createElement("tr");

        let dateDisplay = s.date || "—";
        if (s.date) {
            try { dateDisplay = new Date(s.date + "T00:00:00").toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }); }
            catch (e) {}
        }

        let timeDisplay = s.time || "—";
        if (s.time) {
            try {
                const [h, m] = s.time.split(":");
                const d = new Date(); d.setHours(+h, +m);
                timeDisplay = d.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
            } catch (e) {}
        }

        tr.innerHTML = `
            <td style="font-weight:600;">${s.studentName || "—"}</td>
            <td style="font-family:monospace;font-size:12px;">${s.lrn || "—"}</td>
            <td><span class="badge" style="background:rgba(59,130,246,0.1);color:#93c5fd;border:1px solid rgba(59,130,246,0.2);font-size:10px;">${s.strand || "—"}</span></td>
            <td>${s.gradeLevel || "—"}</td>
            <td style="font-size:13px;">${dateDisplay}</td>
            <td style="font-size:13px;">${timeDisplay}</td>
            <td style="color:var(--text2);">${s.interviewer || "—"}</td>
            <td>${s.mode || "—"}</td>
            <td>${schedStatusBadge(s.status)}</td>
            <td style="font-size:12px;color:var(--text3);max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escHtml(s.notes || "")}">${s.notes || "—"}</td>
            <td class="no-print">
                <div class="action-btns">
                    <button class="btn-sched-edit" onclick="openSchedModal('${s.id}')">✏</button>
                    ${s.status !== "done" ? `<button class="btn-sched-status" onclick="quickSchedStatus('${s.id}','done')">✓ Done</button>` : ""}
                    <button class="btn-sched-del" onclick="openDeleteSchedModal('${s.id}')">🗑</button>
                </div>
            </td>`;
        tbody.appendChild(tr);
    });
};

function schedStatusBadge(status) {
    const map    = { scheduled: "sbadge-scheduled", done: "sbadge-done", cancelled: "sbadge-cancelled", rescheduled: "sbadge-rescheduled", "no-show": "sbadge-no-show" };
    const labels = { scheduled: "📅 Scheduled", done: "✅ Done", cancelled: "❌ Cancelled", rescheduled: "🔄 Rescheduled", "no-show": "🚫 No Show" };
    return `<span class="sbadge ${map[status] || "sbadge-scheduled"}">${labels[status] || status}</span>`;
}

function escHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── OPEN SCHEDULE MODAL ────────────────────────────────────────────
window.openSchedModal = function (id) {
    editSchedId = id || null;

    if (id) {
        const s = allSchedules.find(x => x.id === id);
        if (!s) return;
        document.getElementById("schedModalTitle").textContent = "Edit Interview Schedule";
        document.getElementById("sf-studentName").value = s.studentName  || "";
        document.getElementById("sf-lrn").value         = s.lrn          || "";
        document.getElementById("sf-strand").value      = s.strand        || "";
        document.getElementById("sf-grade").value       = s.gradeLevel    || "";
        document.getElementById("sf-date").value        = s.date          || "";
        document.getElementById("sf-time").value        = s.time          || "";
        document.getElementById("sf-interviewer").value = s.interviewer   || "";
        document.getElementById("sf-mode").value        = s.mode          || "Face-to-Face";
        document.getElementById("sf-status").value      = s.status        || "scheduled";
        document.getElementById("sf-notes").value       = s.notes         || "";
    } else {
        document.getElementById("schedModalTitle").textContent = "Schedule Interview";
        ["sf-studentName","sf-lrn","sf-strand","sf-grade","sf-date","sf-time","sf-interviewer","sf-notes"]
            .forEach(id => { document.getElementById(id).value = ""; });
        document.getElementById("sf-mode").value   = "Face-to-Face";
        document.getElementById("sf-status").value = "scheduled";
    }

    document.getElementById("schedModal").classList.add("show");
    refreshStudentDatalist();
};

// ── SAVE SCHEDULE ──────────────────────────────────────────────────
window.saveSchedule = async function () {
    const name   = document.getElementById("sf-studentName").value.trim();
    const strand = document.getElementById("sf-strand").value;
    const date   = document.getElementById("sf-date").value;
    const time   = document.getElementById("sf-time").value;

    if (!name || !strand || !date || !time) {
        alert("⚠️ Please fill in all required fields (Name, Strand, Date, Time)."); return;
    }

    const data = {
        studentName: name,
        lrn:         document.getElementById("sf-lrn").value.trim(),
        strand,
        gradeLevel:  document.getElementById("sf-grade").value,
        date,
        time,
        interviewer: document.getElementById("sf-interviewer").value.trim(),
        mode:        document.getElementById("sf-mode").value,
        status:      document.getElementById("sf-status").value,
        notes:       document.getElementById("sf-notes").value.trim(),
        updatedAt:   serverTimestamp()
    };

    try {
        if (editSchedId) {
            await updateDoc(doc(db, "interviews", editSchedId), data);
        } else {
            data.createdAt = serverTimestamp();
            await addDoc(collection(db, "interviews"), data);
        }
        closeModal("schedModal");
    } catch (e) {
        alert("Error saving schedule: " + e.message);
    }
};

// ── QUICK STATUS CHANGE ────────────────────────────────────────────
window.quickSchedStatus = async function (id, status) {
    try { await updateDoc(doc(db, "interviews", id), { status, updatedAt: serverTimestamp() }); }
    catch (e) { alert("Failed: " + e.message); }
};

// ── DELETE SCHEDULE ────────────────────────────────────────────────
window.openDeleteSchedModal = function (id) {
    deleteSchedId = id;
    document.getElementById("confirmSchedPassword").value = "";
    document.getElementById("deleteSchedModal").classList.add("show");
};

window.confirmDeleteSched = async function () {
    if (document.getElementById("confirmSchedPassword").value !== ADMIN_PASS) {
        alert("❌ Wrong password"); return;
    }
    try {
        await deleteDoc(doc(db, "interviews", deleteSchedId));
        closeModal("deleteSchedModal");
    } catch (e) { alert("Delete failed: " + e.message); }
};

// ── EXPORT SCHEDULE CSV ────────────────────────────────────────────
window.exportSchedCSV = function () {
    let list = allSchedules;
    if (schedFilter !== "all") list = list.filter(s => s.status === schedFilter);

    let csv = ["Student Name,LRN,Strand,Grade,Date,Time,Interviewer,Mode,Status,Notes"];
    list.forEach(s => {
        csv.push([s.studentName, s.lrn, s.strand, s.gradeLevel, s.date, s.time,
                  s.interviewer, s.mode, s.status, s.notes]
            .map(v => `"${(v || "").toString().replace(/"/g, '""')}"`).join(","));
    });

    const a    = document.createElement("a");
    a.href     = URL.createObjectURL(new Blob([csv.join("\n")], { type: "text/csv" }));
    a.download = `CNHS_Interviews_${new Date().toLocaleDateString("en-PH").replace(/\//g, "-")}.csv`;
    a.click();
};