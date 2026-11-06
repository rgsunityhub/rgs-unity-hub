import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowDownToLine, ArrowUpRight, Bell, Check, CircleHelp, Copy, Expand, File, FileArchive, FileImage,
  FileText, Film, Folder, Globe2, Home, KeyRound, LayoutDashboard, Link2, LockKeyhole, LogOut,
  Menu, MessageCircle, MoreHorizontal, Plus, Search, Send, Settings, Shield, Sparkles, Upload,
  Trash2, Users, Volume2, VolumeX, X, Youtube, type LucideIcon,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import type { Page, Profile, Publication, Role } from "./lib/types";

type NavItem = { id: Page; label: string; icon: LucideIcon; roles?: Role[] };
const navItems: NavItem[] = [
  { id: "home", label: "Beranda", icon: Home },
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "storage", label: "Storage", icon: Folder },
  { id: "youtube", label: "YouTube", icon: Youtube },
  { id: "chat", label: "Community chat", icon: MessageCircle },
  { id: "members", label: "Members", icon: Users },
  { id: "profile", label: "Profil", icon: Shield },
  { id: "invites", label: "Invite code", icon: KeyRound, roles: ["owner", "admin"] },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "settings", label: "Settings", icon: Settings, roles: ["owner"] },
];

const friendlyError = (error: unknown) => error instanceof Error ? error.message : "Terjadi kesalahan. Silakan coba lagi.";
const dateLabel = (value: string) => new Date(value).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
const isRole = (value: unknown): value is Role => value === "owner" || value === "admin" || value === "user";
function getYouTubeVideoId(value: string) {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (hostname === "youtu.be") return parsed.pathname.slice(1).match(/^[\w-]{11}$/)?.[0] ?? null;
    if (!["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(hostname)) return null;
    const id = parsed.searchParams.get("v") ?? parsed.pathname.match(/\/(?:embed|shorts|live)\/([^/?]+)/)?.[1] ?? null;
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
function normalizePublications(rows: unknown): Publication[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value): Publication[] => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.owner_id !== "string" || typeof row.title !== "string" ||
        typeof row.body !== "string" || typeof row.created_at !== "string" ||
        (row.kind !== "text" && row.kind !== "file" && row.kind !== "youtube") ||
        (row.visibility !== "public" && row.visibility !== "private")) return [];
    const joined = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    let author: Publication["profiles"] = null;
    if (joined && typeof joined === "object") {
      const candidate = joined as Record<string, unknown>;
      if (typeof candidate.nickname === "string" && isRole(candidate.role)) {
        author = { nickname: candidate.nickname, avatar_url: typeof candidate.avatar_url === "string" ? candidate.avatar_url : null, role: candidate.role };
      }
    }
    return [{ id: row.id, owner_id: row.owner_id, title: row.title, body: row.body, kind: row.kind, visibility: row.visibility, created_at: row.created_at, profiles: author }];
  });
}

function useRealtimeRefresh(channelName: string, tables: readonly string[], refresh: () => void | Promise<void>, filter?: string, setError?: (message: string) => void) {
  useEffect(() => {
    if (!supabase) return;
    let channel = supabase.channel(channelName);
    for (const table of tables) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, () => {
        void refresh();
      });
    }
    channel.subscribe((status, error) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setError?.(error?.message ?? `Realtime channel ${channelName} failed: ${status}`);
      }
    });
    return () => { void supabase?.removeChannel(channel); };
  }, [channelName, filter, refresh, setError, tables]);
}

const PROFILE_TABLE = ["profiles"] as const;
const HOME_TABLES = ["publications", "profiles"] as const;
const DASHBOARD_TABLES = ["profiles", "publications", "files", "invite_codes"] as const;
const INVITE_TABLE = ["invite_codes"] as const;
const FILE_TABLE = ["files"] as const;
const PUBLICATION_TABLE = ["publications", "profiles"] as const;
const NOTIFICATION_TABLE = ["notifications"] as const;
const ENGAGEMENT_TABLES = ["publication_reactions", "publication_comments"] as const;
const FILE_ENGAGEMENT_TABLES = ["file_reactions", "file_comments"] as const;

function App() {
  const [session, setSession] = useState<Awaited<ReturnType<NonNullable<typeof supabase>["auth"]["getSession"]>>["data"]["session"]>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [page, setPage] = useState<Page>("home");
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState("");
  const [recoveryPending, setRecoveryPending] = useState(window.location.hash.includes("type=recovery"));

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data, error: authError }) => {
      if (!active) return;
      if (authError) setError(authError.message);
      setSession(data.session);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === "PASSWORD_RECOVERY") setRecoveryPending(true);
      if (!nextSession) setProfile(null);
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  const refreshOwnProfile = useCallback(async () => {
    if (!session?.user || !supabase) return;
    const { data, error: queryError } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
    if (queryError) setError(queryError.message);
    else setProfile(data as Profile);
  }, [session?.user?.id]);
  useEffect(() => { void refreshOwnProfile(); }, [refreshOwnProfile]);
  useRealtimeRefresh("rgs-own-profile", PROFILE_TABLE, refreshOwnProfile, session?.user?.id ? `id=eq.${session.user.id}` : undefined, setError);

  const signOut = async () => {
    if (!supabase) return;
    const { error: authError } = await supabase.auth.signOut();
    if (authError) setError(authError.message);
    else { setSession(null); setProfile(null); }
  };

  if (!isSupabaseConfigured) return <AuthPage configured={false} onAuthenticated={setSession} />;
  if (recoveryPending) return <PasswordUpdatePage onComplete={() => setRecoveryPending(false)} />;
  if (loading || (session && !profile)) return <div className="loading-screen"><img src="/rgs-logo.png" alt="" /><span>Menyiapkan hub...</span></div>;
  if (!session || !profile) return <AuthPage configured onAuthenticated={setSession} />;
  const visibleNav = navItems.filter((item) => !item.roles || item.roles.includes(profile.role));
  const selectedPage = visibleNav.some((item) => item.id === page) ? page : "home";

  return (
    <HubLayout profile={profile} selectedPage={selectedPage} navItems={visibleNav} onNavigate={setPage} onSignOut={signOut} setError={setError}>
      {error && <div className="toast error-toast"><CircleHelp size={17} />{error}<button onClick={() => setError("")} aria-label="Tutup"><X size={15} /></button></div>}
      <PageContent page={selectedPage} profile={profile} setProfile={setProfile} setError={setError} />
    </HubLayout>
  );
}

function AuthPage({ configured, onAuthenticated }: { configured: boolean; onAuthenticated: (session: NonNullable<Awaited<ReturnType<NonNullable<typeof supabase>["auth"]["getSession"]>>["data"]["session"]>) => void }) {
  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFailure(""); setMessage("");
    const form = new FormData(event.currentTarget);
    if (!supabase) { setFailure("Lengkapi konfigurasi Supabase di file .env.local lalu jalankan ulang aplikasi."); return; }
    setBusy(true);
    try {
      if (mode === "register") {
        sessionStorage.setItem("rgs:remember-session", "true");
        const nickname = String(form.get("nickname") ?? "").trim();
        const email = String(form.get("email") ?? "").trim();
        const password = String(form.get("password") ?? "");
        const confirmation = String(form.get("confirmation") ?? "");
        const inviteCode = String(form.get("invite") ?? "").trim();
        if (password !== confirmation) throw new Error("Konfirmasi password tidak cocok.");
        if (password.length < 10) throw new Error("Password minimal 10 karakter.");
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { nickname, invite_code: inviteCode } },
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setMessage("Akun berhasil dibuat. Periksa email untuk konfirmasi sebelum login.");
        } else {
          onAuthenticated(data.session);
        }
      } else if (mode === "login") {
        const nickname = String(form.get("nickname") ?? "").trim();
        const password = String(form.get("password") ?? "");
        sessionStorage.setItem("rgs:remember-session", form.get("remember") ? "true" : "false");
        const { data, error: loginError } = await supabase.functions.invoke("login-with-nickname", { body: { nickname, password } });
        if (loginError) throw loginError;
        if (!data?.session) throw new Error("Nickname atau password salah.");
        const { data: authData, error: sessionError } = await supabase.auth.setSession(data.session);
        if (sessionError) throw sessionError;
        if (authData.session) onAuthenticated(authData.session);
      } else {
        const email = String(form.get("email") ?? "").trim();
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        if (resetError) throw resetError;
        setMessage("Jika email terdaftar, tautan reset akan dikirim oleh Supabase Auth.");
      }
    } catch (submitError) {
      setFailure(friendlyError(submitError));
    } finally { setBusy(false); }
  };

  return (
    <main className="auth-page">
      <div className="auth-backdrop" />
      <header className="auth-brand"><img src="/rgs-logo.png" alt="Logo RGS Unity Hub" /><div><strong>RGS <span>UNITY HUB</span></strong><small>REVOLUSI GAMING SPORT</small></div></header>
      <section className="auth-content">
        <div className="auth-copy">
          <div className="eyebrow"><span className="pulse-dot" /> THE COMMUNITY HUB</div>
          <h1>One community.<br /><span>One revolution.</span></h1>
          <p>Tempat berkumpulnya para gamer, kreator, dan pejuang komunitas RGS.</p>
          <div className="auth-pills"><span><Users size={15} /> Komunitas solid</span><span><Shield size={15} /> Akses terjaga</span></div>
        </div>
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-tabs"><button type="button" className={mode !== "register" ? "active" : ""} onClick={() => { setMode("login"); setFailure(""); }}>Masuk</button><button type="button" className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setFailure(""); }}>Daftar</button></div>
          <div className="auth-card-heading"><h2>{mode === "forgot" ? "Reset password" : mode === "register" ? "Gabung komunitas" : "Welcome back"}</h2><p>{mode === "forgot" ? "Kami kirim tautan aman ke email terdaftar." : mode === "register" ? "Buat akun dengan invite code komunitas." : "Masuk ke ruang komunitas RGS."}</p></div>
          {mode !== "forgot" && mode === "register" && <Field label="Nickname" name="nickname" placeholder="Nickname kamu" minLength={3} maxLength={24} required />}
          {mode === "login" && <Field label="Nickname" name="nickname" placeholder="Masukkan nickname" required />}
          {(mode === "register" || mode === "forgot") && <Field label="Email" name="email" type="email" placeholder="kamu@email.com" required />}
          {mode !== "forgot" && <Field label="Password" name="password" type="password" placeholder="Minimal 10 karakter" minLength={10} required />}
          {mode === "register" && <><Field label="Konfirmasi password" name="confirmation" type="password" placeholder="Ulangi password" minLength={10} required /><Field label="Invite code" name="invite" placeholder="Kode undangan komunitas" required /></>}
          {mode === "login" &&           <label className="remember"><input type="checkbox" name="remember" defaultChecked /> Tetap masuk <button type="button" onClick={() => { setMode("forgot"); setFailure(""); }}>Lupa password?</button></label>}
          {failure && <div className="form-message danger">{failure}</div>}
          {message && <div className="form-message success">{message}</div>}
          <button className="button button-primary auth-submit" disabled={busy}>{busy ? "Memproses..." : mode === "forgot" ? "Kirim tautan reset" : mode === "register" ? "Buat akun" : "Masuk ke hub"}<ArrowUpRight size={17} /></button>
          {mode === "forgot" && <button type="button" className="text-button back-login" onClick={() => setMode("login")}>Kembali ke login</button>}
          {!configured && <div className="setup-warning">Supabase belum dikonfigurasi. Salin <code>.env.example</code> menjadi <code>.env.local</code>.</div>}
          <div className="auth-security"><LockKeyhole size={13} /> Kredensial dikelola aman oleh Supabase Auth</div>
        </form>
      </section>
      <footer className="auth-footer">UNITY <i /> GAMING <i /> COMMUNITY <span>© RGS UNITY HUB</span></footer>
    </main>
  );
}

function PasswordUpdatePage({ onComplete }: { onComplete: () => void }) {
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password.length < 10) { setFailure("Password minimal 10 karakter."); return; }
    if (password !== form.get("confirmation")) { setFailure("Konfirmasi password tidak cocok."); return; }
    setBusy(true); setFailure("");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) setFailure(error.message);
    else {
      setUpdated(true);
      window.history.replaceState(null, "", window.location.pathname);
      window.setTimeout(onComplete, 1200);
    }
    setBusy(false);
  };
  return <main className="auth-page reset-page"><header className="auth-brand"><img src="/rgs-logo.png" alt="Logo RGS Unity Hub" /><div><strong>RGS <span>UNITY HUB</span></strong><small>REVOLUSI GAMING SPORT</small></div></header><form className="auth-card reset-card" onSubmit={submit}><div className="auth-card-heading"><h2>Buat password baru</h2><p>Gunakan password kuat minimal 10 karakter.</p></div><Field label="Password baru" name="password" type="password" minLength={10} required /><Field label="Konfirmasi password baru" name="confirmation" type="password" minLength={10} required />{failure && <div className="form-message danger">{failure}</div>}{updated && <div className="form-message success">Password berhasil diperbarui. Mengalihkan...</div>}<button className="button button-primary auth-submit" disabled={busy || updated}>{busy ? "Menyimpan..." : "Simpan password"}<Check size={16} /></button></form></main>;
}

function Field({ label, name, type = "text", ...props }: { label: string; name: string; type?: string; [key: string]: string | number | boolean | undefined }) {
  return <label className="field"><span>{label}</span><input name={name} type={type} {...props} /></label>;
}

function HubLayout({ profile, selectedPage, navItems: items, onNavigate, onSignOut, setError, children }: { profile: Profile; selectedPage: Page; navItems: NavItem[]; onNavigate: (page: Page) => void; onSignOut: () => void; setError: (message: string) => void; children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const pageTitle = items.find((item) => item.id === selectedPage)?.label ?? "Beranda";
  const refreshUnreadCount = useCallback(async () => {
    if (!supabase) return;
    const { count, error } = await supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
    if (error) setError(error.message);
    else setUnreadCount(count ?? 0);
  }, [setError]);
  useEffect(() => { void refreshUnreadCount(); }, [refreshUnreadCount]);
  useRealtimeRefresh("rgs-header-notifications", NOTIFICATION_TABLE, refreshUnreadCount, `user_id=eq.${profile.id}`, setError);
  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand"><img src="/rgs-logo.png" alt="RGS" /><div><strong>RGS <span>UNITY HUB</span></strong><small>REVOLUSI GAMING SPORT</small></div><button className="mobile-close" onClick={() => setMenuOpen(false)} aria-label="Tutup menu"><X size={19} /></button></div>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav">{items.map(({ id, label, icon: Icon }) => <button key={id} className={selectedPage === id ? "nav-link selected" : "nav-link"} onClick={() => { onNavigate(id); setMenuOpen(false); }}><Icon size={18} /><span>{label}</span>{id === "notifications" && unreadCount > 0 && <span className="nav-indicator">{unreadCount > 99 ? "99+" : unreadCount}</span>}</button>)}</nav>
        <div className="sidebar-bottom">
          <div className="community-card"><div className="community-mark"><Sparkles size={16} /></div><strong>RGS Community</strong><span>UNITY • GAMING • COMMUNITY</span></div>
          <div className="sidebar-user"><Avatar profile={profile} /><div className="user-meta"><strong>{profile.nickname}</strong><span><RoleBadge role={profile.role} /></span></div><button className="icon-button" onClick={onSignOut} title="Keluar"><LogOut size={17} /></button></div>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar"><button className="mobile-menu icon-button" onClick={() => setMenuOpen(true)} aria-label="Buka menu"><Menu size={20} /></button><div className="breadcrumb">RGS HUB <span>/</span> <strong>{pageTitle}</strong></div><div className="topbar-actions"><div className="online-indicator">RGS COMMUNITY</div><button className="icon-button notification-button" onClick={() => onNavigate("notifications")} aria-label={unreadCount ? `Notifikasi, ${unreadCount} belum dibaca` : "Notifikasi"} title={unreadCount ? `${unreadCount} notifikasi belum dibaca` : "Notifikasi"}><Bell size={18} />{unreadCount > 0 && <i />}</button><button className="top-avatar" onClick={() => onNavigate("profile")} aria-label={`Buka profil ${profile.nickname}`} title={profile.nickname}><Avatar profile={profile} /></button></div></header>
        <main className="page-container">{children}</main>
      </div>
      {menuOpen && <button className="mobile-overlay" onClick={() => setMenuOpen(false)} aria-label="Tutup navigasi" />}
    </div>
  );
}

function PageContent({ page, profile, setProfile, setError }: { page: Page; profile: Profile; setProfile: (profile: Profile) => void; setError: (message: string) => void }) {
  switch (page) {
    case "home": return <HomePage profile={profile} setError={setError} />;
    case "dashboard": return <DashboardPage profile={profile} setError={setError} />;
    case "members": return <MembersPage profile={profile} setError={setError} />;
    case "storage": return <StoragePage profile={profile} setError={setError} />;
    case "youtube": return <YouTubePage profile={profile} setError={setError} />;
    case "chat": return <ChatPage profile={profile} setError={setError} />;
    case "profile": return <ProfilePage profile={profile} setProfile={setProfile} setError={setError} />;
    case "invites": return <InvitesPage profile={profile} setError={setError} />;
    case "notifications": return <NotificationsPage setError={setError} />;
    case "settings": return <SettingsPage />;
    default: return <HomePage profile={profile} setError={setError} />;
  }
}

function HomePage({ profile, setError }: { profile: Profile; setError: (message: string) => void }) {
  const [posts, setPosts] = useState<Publication[]>([]);
  const [loading, setLoading] = useState(true);
  const [compose, setCompose] = useState(false);
  const [search, setSearch] = useState("");
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from("publications").select("*, profiles!publications_owner_id_fkey(nickname, avatar_url, role)").eq("visibility", "public").order("created_at", { ascending: false }).limit(25);
    if (error) setError(error.message); else setPosts(normalizePublications(data));
    setLoading(false);
  }, [setError]);
  useEffect(() => { void load(); }, [load]);
  useRealtimeRefresh("rgs-home-feed", HOME_TABLES, load, undefined, setError);
  const filtered = posts.filter((post) => `${post.title} ${post.body} ${post.profiles?.nickname}`.toLowerCase().includes(search.toLowerCase()));
  const publish = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    const form = new FormData(event.currentTarget);
    const { error } = await supabase.from("publications").insert({ owner_id: profile.id, kind: "text", title: String(form.get("title")).trim(), body: String(form.get("body")).trim(), visibility: "public" });
    if (error) setError(error.message);
    else { setCompose(false); await load(); }
  };
  return <>
    <PageHeading eyebrow="RGS COMMUNITY" title={<>Beranda<span className="title-dot">.</span></>} subtitle="Cerita, karya, dan momen dari keluarga besar RGS." action={<button className="button button-primary" onClick={() => setCompose((open) => !open)}><Plus size={17} /> Buat publikasi</button>} />
    {compose && <form className="compose-card" onSubmit={publish}><Field label="Judul publikasi" name="title" placeholder="Apa yang ingin kamu bagikan?" maxLength={100} required /><label className="field"><span>Cerita kamu</span><textarea name="body" placeholder="Tulis sesuatu untuk komunitas..." maxLength={2000} rows={3} required /></label><div className="compose-footer"><span><Globe2 size={14} /> Publik — terlihat oleh semua member</span><button className="button button-primary"><Send size={15} /> Publikasikan</button></div></form>}
    <div className="feed-toolbar"><div className="feed-tabs"><button className="active">Terbaru</button></div><label className="search-box"><Search size={16} /><input placeholder="Cari publikasi..." value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
    <section className="feed-list">{loading ? <LoadingLine /> : filtered.length ? filtered.map((post) => <PublicationCard key={post.id} post={post} profileId={profile.id} onDelete={load} setError={setError} />) : <EmptyState title="Belum ada publikasi" body="Jadilah yang pertama membagikan kabar ke komunitas RGS." />}</section>
    <PublicFilesFeed profileId={profile.id} setError={setError} />
    <div className="feed-footer">Menampilkan publikasi publik komunitas <span>RGS UNITY HUB</span></div>
  </>;
}

function DashboardPage({ profile, setError }: { profile: Profile; setError: (message: string) => void }) {
  const [counts, setCounts] = useState({ members: 0, admins: 0, users: 0, posts: 0, files: 0, publicFiles: 0, privateFiles: 0, storageBytes: 0, invites: 0, inviteUses: 0, myPosts: 0 });
  const [recent, setRecent] = useState<Publication[]>([]);
  const load = useCallback(async () => {
    if (!supabase) return;
    const [members, admins, users, posts, files, myPosts, invites, feed] = await Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin"),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "user"),
      supabase.from("publications").select("id", { count: "exact", head: true }).eq("visibility", "public"),
      supabase.from("files").select("size_bytes, visibility").eq("owner_id", profile.id),
      supabase.from("publications").select("id", { count: "exact", head: true }).eq("owner_id", profile.id),
      supabase.from("invite_codes").select("max_uses, used_count"),
      supabase.from("publications").select("*, profiles!publications_owner_id_fkey(nickname, avatar_url, role)").eq("visibility", "public").order("created_at", { ascending: false }).limit(4),
    ]);
    const fileRows = files.data ?? [];
    const inviteRows = invites.data ?? [];
    const queryError = [members.error, admins.error, users.error, posts.error, files.error, myPosts.error, invites.error, feed.error].find(Boolean);
    if (queryError) setError(queryError.message);
    setCounts({
      members: members.count ?? 0,
      admins: admins.count ?? 0,
      users: users.count ?? 0,
      posts: posts.count ?? 0,
      files: fileRows.length,
      publicFiles: fileRows.filter((file) => file.visibility === "public").length,
      privateFiles: fileRows.filter((file) => file.visibility === "private").length,
      storageBytes: fileRows.reduce((total, file) => total + Number(file.size_bytes), 0),
      invites: inviteRows.length,
      inviteUses: inviteRows.reduce((total, invite) => total + invite.used_count, 0),
      myPosts: myPosts.count ?? 0,
    });
    setRecent(normalizePublications(feed.data));
  }, [profile.id, setError]);
  useEffect(() => { void load(); }, [load]);
  useRealtimeRefresh("rgs-dashboard", DASHBOARD_TABLES, load, undefined, setError);
  const stats = profile.role === "owner"
    ? [
      { label: "Total member", value: counts.members, icon: Users, tone: "purple", note: "Semua anggota" },
      { label: "Admin", value: counts.admins, icon: Shield, tone: "blue", note: "Role admin" },
      { label: "User", value: counts.users, icon: Users, tone: "green", note: "Role user" },
      { label: "Publikasi", value: counts.posts, icon: Sparkles, tone: "blue", note: "Konten publik" },
      { label: "Invite code", value: counts.invites, icon: KeyRound, tone: "amber", note: `${counts.inviteUses} kali digunakan` },
    ]
    : profile.role === "admin"
      ? [
        { label: "Total member", value: counts.members, icon: Users, tone: "purple", note: "Anggota terdaftar" },
        { label: "Invite code", value: counts.invites, icon: KeyRound, tone: "amber", note: `${counts.inviteUses} kali digunakan` },
      ]
      : [
        { label: "Publikasi saya", value: counts.myPosts, icon: Sparkles, tone: "blue", note: "Semua status" },
        { label: "File saya", value: counts.files, icon: Folder, tone: "green", note: `${formatBytes(counts.storageBytes)} digunakan` },
        { label: "File publik", value: counts.publicFiles, icon: Globe2, tone: "purple", note: "Dapat dilihat member" },
        { label: "File privat", value: counts.privateFiles, icon: LockKeyhole, tone: "amber", note: "Hanya kamu" },
      ];
  return <>
    <PageHeading eyebrow={`${profile.role.toUpperCase()} WORKSPACE`} title={<>Dashboard<span className="title-dot">.</span></>} subtitle={`Selamat datang kembali, ${profile.nickname}.`} />
    <div className="welcome-banner"><div className="banner-watermark" /><div className="banner-copy"><span className="eyebrow">UNITY • GAMING • COMMUNITY</span><h2>Make your mark<br />in the community.</h2><p>Berbagi karya. Bangun koneksi. Tumbuh bersama RGS.</p></div><img src="/rgs-logo.png" alt="" /></div>
    <section className="stats-grid">{stats.map(({ label, value, icon: Icon, tone, note }) => <div className="stat-card" key={label}><div className={`stat-icon ${tone}`}><Icon size={18} /></div><span className="stat-label">{label}</span><strong>{value.toLocaleString("id-ID")}</strong><small>{note}</small></div>)}</section>
    <div className="section-heading"><div><span className="eyebrow">COMMUNITY PULSE</span><h2>Aktivitas terbaru</h2></div><span className="live-tag"><i /> LIVE FEED</span></div>
    <div className="feed-list">{recent.length ? recent.map((post) => <PublicationCard key={post.id} post={post} profileId={profile.id} onDelete={load} setError={setError} />) : <EmptyState title="Ruang masih tenang" body="Publikasi terbaru akan muncul di sini." />}</div>
    <PublicFilesFeed profileId={profile.id} setError={setError} />
  </>;
}

function PublicFilesFeed({ profileId, setError }: { profileId: string; setError: (message: string) => void }) {
  type PublicFile = { id: string; owner_id: string; name: string; size_bytes: number; mime_type: string; created_at: string; storage_path: string; profiles?: { nickname: string } | { nickname: string }[] | null };
  const [files, setFiles] = useState<PublicFile[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from("files")
      .select("id, owner_id, name, size_bytes, mime_type, created_at, storage_path, profiles!files_owner_id_fkey(nickname)")
      .eq("visibility", "public")
      .order("created_at", { ascending: false })
      .limit(6);
    if (error) setError(error.message);
    else setFiles((data ?? []) as PublicFile[]);
    setLoading(false);
  }, [setError]);
  useEffect(() => { void load(); }, [load]);
  useRealtimeRefresh("rgs-public-files-feed", FILE_TABLE, load, undefined, setError);
  const download = async (file: PublicFile) => {
    if (!supabase) return "Supabase belum dikonfigurasi.";
    const { data, error } = await supabase.storage.from("member-files").createSignedUrl(file.storage_path, 60);
    if (error) return error.message;
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    return null;
  };
  return <>
    <div className="section-heading public-files-heading"><div><span className="eyebrow">SHARED WITH COMMUNITY</span><h2>File publik terbaru</h2></div><span className="member-count">{files.length} file</span></div>
    {loading ? <LoadingLine /> : files.length ? <div className="public-feed-files">{files.map((file) => {
      const joinedProfile = Array.isArray(file.profiles) ? file.profiles[0] : file.profiles;
      return <PublicFileCard key={file.id} file={file} profileId={profileId} ownerName={joinedProfile?.nickname ?? "Member"} onDownload={() => download(file)} setError={setError} />;
    })}</div> : <EmptyState title="Belum ada file publik" body="File yang diunggah ke Storage dengan visibilitas Public akan muncul di sini." />}
  </>;
}

function PublicFileCard({ file, profileId, ownerName, onDownload, setError }: { file: { id: string; name: string; mime_type: string; size_bytes: number; created_at: string; storage_path: string }; profileId: string; ownerName: string; onDownload: () => Promise<string | null>; setError: (message: string) => void }) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);
  const [fileError, setFileError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const kind = file.mime_type.startsWith("image/") ? "image"
    : file.mime_type.startsWith("video/") ? "video"
      : file.mime_type === "application/pdf" || extension === "pdf" ? "pdf"
        : file.mime_type === "application/zip" || ["zip", "rar", "7z"].includes(extension) ? "archive"
          : file.mime_type.startsWith("text/") || ["txt", "md", "log"].includes(extension) ? "text" : "file";
  useEffect(() => {
    if ((kind !== "image" && kind !== "video") || !supabase) return;
    let active = true;
    supabase.storage.from("member-files").createSignedUrl(file.storage_path, 3600).then(({ data, error }) => {
      if (!active) return;
      if (error) setFileError(error.message);
      else setPreviewUrl(data.signedUrl);
    });
    return () => { active = false; };
  }, [file.storage_path, kind]);
  useEffect(() => {
    if (!previewOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [previewOpen]);
  const TypeIcon = kind === "image" ? FileImage : kind === "video" ? Film : kind === "pdf" || kind === "text" ? FileText : kind === "archive" ? FileArchive : File;
  const typeLabel = kind === "pdf" ? "PDF" : kind === "archive" ? extension.toUpperCase() : kind === "text" ? extension.toUpperCase() || "TEXT" : kind === "video" ? "VIDEO" : kind === "image" ? extension.toUpperCase() : "FILE";
  const missingObject = fileError.toLowerCase().includes("object not found");
  const handleDownload = async () => {
    const error = await onDownload();
    if (error) setFileError(error);
  };
  return <div className="public-file-entry"><article className={`public-feed-file ${kind}`}>
    <div className="public-file-preview">
      {kind === "image" && previewUrl && !previewFailed
        ? <button className="public-image-preview-button" type="button" aria-label={`Perbesar gambar ${file.name}`} title="Klik untuk memperbesar" onClick={() => setPreviewOpen(true)}><img src={previewUrl} alt={`Pratinjau ${file.name}`} loading="lazy" onError={() => { setPreviewFailed(true); setFileError("Preview gagal dimuat."); }} /></button>
        : kind === "video" && previewUrl
          ? <button className="public-video-preview-button" type="button" aria-label={`Buka pratinjau video ${file.name}`} title="Klik untuk membuka video" onClick={() => setPreviewOpen(true)}><video className="public-file-video" src={previewUrl} autoPlay loop muted playsInline aria-hidden="true" onError={() => setFileError("Preview gagal dimuat.")} /></button>
          : <button className="public-file-type-preview" type="button" aria-label={`Lihat file ${file.name}`} title="Klik untuk melihat file" onClick={() => setPreviewOpen(true)}><div className={`file-type-icon ${kind}`}><TypeIcon size={20} /></div><span>{typeLabel}</span></button>}
    </div>
    {previewOpen && <FilePreviewModal file={file} ownerName={ownerName} onClose={() => setPreviewOpen(false)} />}
    <div className="file-row-name"><button className="file-preview-name" type="button" onClick={() => setPreviewOpen(true)}>{file.name}</button><span>{typeLabel} · {formatBytes(file.size_bytes)} · {dateLabel(file.created_at)} · oleh {ownerName}</span>{fileError && <span className="public-file-error" role="status">{missingObject ? "File tidak tersedia. Pemilik perlu menghapus entri lama di Storage, lalu mengunggah ulang file." : `File tidak dapat dimuat: ${fileError}`}</span>}</div>
    <span className="visibility-chip public"><Globe2 size={13} />Public</span>
    <button className="icon-button" title={`Unduh ${file.name}`} aria-label={`Unduh ${file.name}`} onClick={() => void handleDownload()}><ArrowDownToLine size={17} /></button>
  </article><Engagement targetType="file" targetId={file.id} profileId={profileId} setError={setError} /></div>;
}

function FilePreviewModal({ file, ownerName, onClose }: { file: { name: string; mime_type: string; size_bytes: number; storage_path: string }; ownerName: string; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const isImage = file.mime_type.startsWith("image/");
  const isVideo = file.mime_type.startsWith("video/");
  const isPdf = file.mime_type === "application/pdf" || extension === "pdf";
  const isText = file.mime_type.startsWith("text/") || ["txt", "md", "log"].includes(extension);
  const TypeIcon = isImage ? FileImage : isVideo ? Film : isPdf || isText ? FileText : ["zip", "rar", "7z"].includes(extension) ? FileArchive : File;

  useEffect(() => {
    let active = true;
    if (!supabase) {
      setError("Supabase belum dikonfigurasi.");
      return () => { active = false; };
    }
    supabase.storage.from("member-files").createSignedUrl(file.storage_path, 300).then(({ data, error: signedUrlError }) => {
      if (!active) return;
      if (signedUrlError) setError(signedUrlError.message);
      else setUrl(data.signedUrl);
    });
    return () => { active = false; };
  }, [file.storage_path]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === playerRef.current);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  const download = async () => {
    if (!supabase) return;
    const { data, error: downloadError } = await supabase.storage.from("member-files").createSignedUrl(file.storage_path, 60, { download: file.name });
    if (downloadError) setError(downloadError.message);
    else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };
  const setVideoVolume = (nextVolume: number) => {
    const video = videoRef.current;
    if (video) {
      video.volume = nextVolume;
      video.muted = nextVolume === 0;
    }
    setVolume(nextVolume);
  };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === playerRef.current) await document.exitFullscreen();
      else await playerRef.current?.requestFullscreen();
    } catch (fullscreenError) {
      setError(fullscreenError instanceof Error ? fullscreenError.message : "Mode layar penuh tidak tersedia di browser ini.");
    }
  };

  const unsupportedPreview = !isImage && !isVideo && !isPdf && !isText;
  return <div className="image-lightbox-backdrop" onClick={onClose}>
    <section className="image-lightbox file-preview-modal" role="dialog" aria-modal="true" aria-label={`Pratinjau file ${file.name}`} onClick={(event) => event.stopPropagation()}>
      <button className="image-lightbox-close icon-button" type="button" aria-label="Tutup pratinjau file" onClick={onClose}><X size={20} /></button>
      <div className="file-preview-content">
        {!url && !error && <LoadingLine />}
        {error && <div className="file-preview-message"><TypeIcon size={30} /><strong>File tidak dapat dibuka</strong><span>{error.toLowerCase().includes("object not found") ? "Objek file tidak ditemukan di Storage." : error}</span></div>}
        {url && isImage && <img className="image-lightbox-image" src={url} alt={file.name} />}
        {url && isVideo && <div ref={playerRef} className={`file-video-player ${isFullscreen ? "fullscreen" : ""}`}><video ref={videoRef} className="file-preview-video" src={url} controls controlsList="nodownload noplaybackrate noremoteplayback nofullscreen" disablePictureInPicture disableRemotePlayback playsInline onVolumeChange={(event) => setVolume(event.currentTarget.muted ? 0 : event.currentTarget.volume)} /><div className="file-video-volume"><button className="icon-button" type="button" aria-label={volume === 0 ? "Nyalakan suara video" : "Matikan suara video"} title={volume === 0 ? "Nyalakan suara" : "Matikan suara"} onClick={() => setVideoVolume(volume === 0 ? 1 : 0)}>{volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}</button><input type="range" min="0" max="1" step="0.05" value={volume} aria-label="Volume video" onChange={(event) => setVideoVolume(Number(event.target.value))} /><span>{Math.round(volume * 100)}%</span><button className="icon-button" type="button" aria-label={isFullscreen ? "Keluar dari layar penuh" : "Layar penuh"} title={isFullscreen ? "Keluar layar penuh" : "Layar penuh"} onClick={() => void toggleFullscreen()}><Expand size={17} /></button></div></div>}
        {url && isPdf && <iframe className="file-preview-iframe" src={url} title={`Pratinjau ${file.name}`} />}
        {url && isText && <iframe className="file-preview-iframe text" src={url} title={`Pratinjau ${file.name}`} sandbox="" />}
        {url && unsupportedPreview && <div className="file-preview-message"><TypeIcon size={30} /><strong>Pratinjau tidak tersedia</strong><span>Jenis file ini tidak mendukung pratinjau langsung. Unduh file untuk membukanya.</span><button className="button button-primary" type="button" onClick={() => void download()}><ArrowDownToLine size={15} />Unduh file</button></div>}
      </div>
      <div className="image-lightbox-caption"><strong>{file.name}</strong><span>{formatBytes(file.size_bytes)} · oleh {ownerName}</span>{url && !unsupportedPreview && <button className="icon-button" type="button" aria-label={`Unduh ${file.name}`} title="Unduh file" onClick={() => void download()}><ArrowDownToLine size={17} /></button>}</div>
    </section>
  </div>;
}

function MembersPage({ profile, setError }: { profile: Profile; setError: (message: string) => void }) {
  const [members, setMembers] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<Profile | null>(null);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error: queryError } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
    if (queryError) setError(queryError.message); else setMembers((data ?? []) as Profile[]);
  }, [setError]);
  useEffect(() => { void load(); }, [load]);
  useRealtimeRefresh("rgs-members", PROFILE_TABLE, load, undefined, setError);
  const updateRole = async (member: Profile, nextRole: Role) => {
    if (!supabase) return;
    const { data, error } = await supabase.from("profiles").update({ role: nextRole }).eq("id", member.id).select("*").single();
    if (error) setError(error.message);
    else {
      const updated = data as Profile;
      setMembers((current) => current.map((item) => item.id === updated.id ? updated : item));
      setSelected((current) => current?.id === updated.id ? updated : current);
    }
  };
  const visible = members.filter((member) => member.nickname.toLowerCase().includes(query.toLowerCase()) && (role === "all" || member.role === role));
  return <>
    <PageHeading eyebrow="OUR PEOPLE" title={<>Members<span className="title-dot">.</span></>} subtitle="Kenali para pemain dan kreator di balik komunitas RGS." />
    <div className="members-toolbar"><label className="search-box"><Search size={16} /><input placeholder="Cari nickname..." value={query} onChange={(event) => setQuery(event.target.value)} /></label><select className="filter-select" value={role} onChange={(event) => setRole(event.target.value)}><option value="all">Semua role</option><option value="owner">Owner</option><option value="admin">Admin</option><option value="user">User</option></select><span className="member-count">{visible.length} member</span></div>
    <div className="members-grid">{visible.map((member) => <article className="member-card" key={member.id}><div className="member-card-top"><Avatar profile={member} large /><span className="online-badge"><i /> MEMBER</span></div><h3>{member.nickname}</h3><RoleBadge role={member.role} /><div className="member-card-meta"><span>Bergabung</span><strong>{dateLabel(member.created_at)}</strong></div>{profile.role === "owner" && member.id !== profile.id && <label className="role-control"><span>Role member</span><select value={member.role} onChange={(event) => void updateRole(member, event.target.value as Role)}><option value="user">User</option><option value="admin">Admin</option><option value="owner">Owner</option></select></label>}{member.id === profile.id && <div className="role-control"><span>Role akun Anda</span><strong>Dikelola melalui prosedur pemulihan owner</strong></div>}<button className="button button-outline member-profile" onClick={() => setSelected(member)}>Lihat profil <ArrowUpRight size={14} /></button></article>)}</div>
    {!visible.length && <EmptyState title="Member tidak ditemukan" body="Coba ubah kata pencarian atau filter role." />}
    {selected && <div className="modal-backdrop" onClick={() => setSelected(null)}><section className="member-modal" role="dialog" aria-modal="true" aria-label={`Profil ${selected.nickname}`} onClick={(event) => event.stopPropagation()}><button className="modal-close icon-button" onClick={() => setSelected(null)} aria-label="Tutup"><X size={18} /></button><div className="modal-avatar"><Avatar profile={selected} large /></div><h2>{selected.nickname}</h2><RoleBadge role={selected.role} /><p>{selected.bio || "Member komunitas RGS Unity Hub."}</p><div className="member-card-meta"><span>Bergabung</span><strong>{dateLabel(selected.created_at)}</strong></div></section></div>}
  </>;
}

function StorageFilePreview({ file, onOpen }: { file: { name: string; mime_type: string; storage_path: string }; onOpen: () => void }) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const kind = file.mime_type.startsWith("image/") ? "image"
    : file.mime_type.startsWith("video/") ? "video"
      : file.mime_type === "application/pdf" || extension === "pdf" ? "pdf"
        : file.mime_type === "application/zip" || ["zip", "rar", "7z"].includes(extension) ? "archive"
          : file.mime_type.startsWith("text/") || ["txt", "md", "log"].includes(extension) ? "text" : "file";
  const TypeIcon = kind === "image" ? FileImage : kind === "video" ? Film : kind === "pdf" || kind === "text" ? FileText : kind === "archive" ? FileArchive : File;
  const typeLabel = kind === "pdf" ? "PDF" : kind === "archive" ? extension.toUpperCase() : kind === "text" ? extension.toUpperCase() || "TXT" : kind === "image" || kind === "video" ? extension.toUpperCase() : "FILE";

  useEffect(() => {
    setPreviewUrl("");
    setPreviewFailed(false);
    if ((kind !== "image" && kind !== "video") || !supabase) return;
    let active = true;
    supabase.storage.from("member-files").createSignedUrl(file.storage_path, 3600).then(({ data, error }) => {
      if (!active) return;
      if (error) setPreviewFailed(true);
      else setPreviewUrl(data.signedUrl);
    });
    return () => { active = false; };
  }, [file.storage_path, kind]);

  return <button className={`storage-file-preview ${kind}`} type="button" aria-label={`Pratinjau ${file.name}`} title={`Pratinjau ${file.name}`} onClick={onOpen}>
    {previewUrl && !previewFailed && kind === "image"
      ? <img src={previewUrl} alt="" loading="lazy" onError={() => setPreviewFailed(true)} />
      : previewUrl && !previewFailed && kind === "video"
        ? <video src={previewUrl} autoPlay loop muted playsInline aria-hidden="true" onError={() => setPreviewFailed(true)} />
        : <><span className={`file-type-icon ${kind}`}><TypeIcon size={18} /></span><small>{typeLabel}</small></>}
  </button>;
}

function StoragePage({ profile, setError }: { profile: Profile; setError: (message: string) => void }) {
  type StoredFile = { id: string; owner_id: string; name: string; mime_type: string; size_bytes: number; visibility: "public" | "private"; created_at: string; storage_path: string; profiles?: { nickname: string } | { nickname: string }[] | null };
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [sharedFiles, setSharedFiles] = useState<StoredFile[]>([]);
  const [previewFile, setPreviewFile] = useState<StoredFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [visibilityBusyId, setVisibilityBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from("files").select("id, owner_id, name, mime_type, size_bytes, visibility, created_at, storage_path, profiles!files_owner_id_fkey(nickname)").order("created_at", { ascending: false });
    if (error) { setError(error.message); return; }
    const visibleFiles = (data ?? []) as StoredFile[];
    setFiles(visibleFiles.filter((file) => file.owner_id === profile.id));
    setSharedFiles(visibleFiles.filter((file) => file.visibility === "public"));
  }, [profile.id, setError]);
  useEffect(() => { void load(); }, [load]);
  useRealtimeRefresh("rgs-storage", FILE_TABLE, load, undefined, setError);
  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("upload") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !supabase) return;
    if (file.size > 25 * 1024 * 1024) { setError("Ukuran file maksimal 25 MB."); return; }
    const allowedTypes = ["image/png", "image/jpeg", "image/gif", "image/webp", "video/mp4", "video/webm", "application/pdf", "text/plain", "application/zip"];
    if (!allowedTypes.includes(file.type)) { setError("Tipe file tidak didukung. Gunakan gambar, MP4/WebM, PDF, TXT, atau ZIP."); return; }
    const selectedVisibility = new FormData(form).get("visibility");
    if (selectedVisibility !== "public" && selectedVisibility !== "private") {
      setError("Pilih visibilitas file Public atau Private.");
      return;
    }
    const visibility = selectedVisibility;
    setBusy(true);
    const storagePath = `${profile.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
    const { error: uploadError } = await supabase.storage.from("member-files").upload(storagePath, file, { upsert: false });
    if (uploadError) { setError(uploadError.message); setBusy(false); return; }
    const { error: insertError } = await supabase.from("files").insert({ owner_id: profile.id, name: file.name, size_bytes: file.size, mime_type: file.type || "application/octet-stream", visibility, storage_path: storagePath });
    if (insertError) {
      const { error: cleanupError } = await supabase.storage.from("member-files").remove([storagePath]);
      setError(cleanupError ? `${insertError.message}; file sementara tidak berhasil dibersihkan.` : insertError.message);
    } else { await load(); form.reset(); }
    setBusy(false);
  };
  const download = async (path: string) => {
    if (!supabase) return;
    const { data, error } = await supabase.storage.from("member-files").createSignedUrl(path, 60);
    if (error) setError(error.message.toLowerCase().includes("object not found")
      ? "Objek file tidak ditemukan. Hapus entri file yang rusak, lalu unggah ulang file melalui Storage."
      : error.message);
    else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };
  const toggleVisibility = async (file: StoredFile) => {
    if (!supabase || file.owner_id !== profile.id || visibilityBusyId) return;
    const nextVisibility = file.visibility === "public" ? "private" : "public";
    setVisibilityBusyId(file.id);
    const { error } = await supabase.from("files").update({ visibility: nextVisibility }).eq("id", file.id).eq("owner_id", profile.id);
    if (error) setError(error.message);
    else await load();
    setVisibilityBusyId(null);
  };
  const remove = async (file: (typeof files)[number]) => {
    if (!supabase || !window.confirm(`Hapus ${file.name}?`)) return;
    const { error: rowError } = await supabase.from("files").delete().eq("id", file.id);
    if (rowError) { setError(rowError.message); return; }
    const { error: objectError } = await supabase.storage.from("member-files").remove([file.storage_path]);
    if (objectError) setError(`Metadata file terhapus, tetapi objek belum terhapus: ${objectError.message}`);
    await load();
  };
  const filtered = files.filter((file) => file.name.toLowerCase().includes(query.toLowerCase()));
  const used = files.reduce((total, file) => total + file.size_bytes, 0);
  return <>
    <PageHeading eyebrow="YOUR CLOUD SPACE" title={<>Storage<span className="title-dot">.</span></>} subtitle="Simpan, atur, dan bagikan file komunitas dengan aman." />
    <div className="storage-summary"><div className="storage-summary-icon"><Folder size={21} /></div><div><span>Storage pribadi</span><strong>{formatBytes(used)} <small>digunakan</small></strong></div><div className="storage-progress"><i style={{ width: `${Math.min(used / (1024 * 1024 * 1024) * 100, 100)}%` }} /></div><small>Batas upload per file: 25 MB</small></div>
    <form className="upload-panel" onSubmit={upload}><div className="upload-icon"><Upload size={19} /></div><div className="upload-copy"><strong>Upload file baru</strong><span>Public dapat dilihat dan diunduh anggota; Private hanya terlihat oleh kamu.</span></div><select className="filter-select" name="visibility" defaultValue="private" disabled={busy}><option value="private">Private</option><option value="public">Public</option></select><label className="button button-primary upload-button"><Upload size={16} />{busy ? "Mengunggah..." : "Pilih file"}<input name="upload" type="file" accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,application/pdf,text/plain,application/zip" required disabled={busy} /></label><button className="button button-outline" disabled={busy}>Upload</button></form>
    <div className="members-toolbar storage-toolbar"><label className="search-box"><Search size={16} /><input placeholder="Cari file..." value={query} onChange={(event) => setQuery(event.target.value)} /></label><span className="member-count">{files.length} file</span></div>
    <div className="file-list">{filtered.map((file) => <div className="storage-file-entry" key={file.id}><div className="file-row"><StorageFilePreview file={file} onOpen={() => setPreviewFile(file)} /><div className="file-row-name"><button className="file-preview-name" type="button" onClick={() => setPreviewFile(file)}>{file.name}</button><span>{formatBytes(file.size_bytes)} · {dateLabel(file.created_at)}</span></div><button className={`visibility-chip ${file.visibility} visibility-toggle`} disabled={visibilityBusyId === file.id} onClick={() => void toggleVisibility(file)} title={`Ubah menjadi ${file.visibility === "public" ? "Private" : "Public"}`} aria-label={`${file.name}: ${file.visibility}. Ubah menjadi ${file.visibility === "public" ? "Private" : "Public"}`}>{file.visibility === "public" ? <Globe2 size={13} /> : <LockKeyhole size={13} />}{visibilityBusyId === file.id ? "Menyimpan..." : file.visibility}</button><div className="file-actions"><button className="icon-button" title="Unduh" onClick={() => void download(file.storage_path)}><ArrowDownToLine size={17} /></button><button className="icon-button" title="Hapus" onClick={() => void remove(file)}><X size={17} /></button></div></div><Engagement targetType="file" targetId={file.id} profileId={profile.id} setError={setError} /></div>)}</div>
    {!filtered.length && <EmptyState title="Belum ada file" body="Upload file pertamamu untuk mulai menggunakan storage." />}
    <div className="section-heading"><div><span className="eyebrow">SHARED WITH COMMUNITY</span><h2>File publik</h2></div><span className="member-count">{sharedFiles.length} file</span></div>
    <div className="file-list">{sharedFiles.filter((file) => file.name.toLowerCase().includes(query.toLowerCase())).map((file) => { const joinedProfile = Array.isArray(file.profiles) ? file.profiles[0] : file.profiles; return <div className="storage-file-entry" key={file.id}><div className="file-row"><StorageFilePreview file={file} onOpen={() => setPreviewFile(file)} /><div className="file-row-name"><button className="file-preview-name" type="button" onClick={() => setPreviewFile(file)}>{file.name}</button><span>{formatBytes(file.size_bytes)} · {dateLabel(file.created_at)} · oleh {joinedProfile?.nickname ?? "Member"}</span></div>{file.owner_id === profile.id ? <button className="visibility-chip public visibility-toggle" disabled={visibilityBusyId === file.id} onClick={() => void toggleVisibility(file)} title="Ubah menjadi Private" aria-label={`${file.name}: Public. Ubah menjadi Private`}><Globe2 size={13} />{visibilityBusyId === file.id ? "Menyimpan..." : "Public"}</button> : <span className="visibility-chip public"><Globe2 size={13} />Public</span>}<div className="file-actions"><button className="icon-button" title={`Unduh ${file.name}`} onClick={() => void download(file.storage_path)}><ArrowDownToLine size={17} /></button></div></div><Engagement targetType="file" targetId={file.id} profileId={profile.id} setError={setError} /></div>; })}</div>
    {!sharedFiles.some((file) => file.name.toLowerCase().includes(query.toLowerCase())) && <EmptyState title="Belum ada file publik" body="File yang diunggah dengan visibilitas Public akan muncul di sini." />}
    {previewFile && <FilePreviewModal file={previewFile} ownerName={previewFile.owner_id === profile.id ? profile.nickname : (Array.isArray(previewFile.profiles) ? previewFile.profiles[0]?.nickname : previewFile.profiles?.nickname) ?? "Member"} onClose={() => setPreviewFile(null)} />}
  </>;
}

function YouTubePage({ profile, setError }: { profile: Profile; setError: (message: string) => void }) {
  const [videos, setVideos] = useState<Publication[]>([]);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [visibilityBusyId, setVisibilityBusyId] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from("publications").select("*, profiles!publications_owner_id_fkey(nickname, avatar_url, role)").eq("kind", "youtube").order("created_at", { ascending: false });
    if (error) setError(error.message); else setVideos(normalizePublications(data));
  }, [setError]);
  useEffect(() => { void load(); }, [load]);
  useRealtimeRefresh("rgs-youtube", PUBLICATION_TABLE, load, undefined, setError);
  const addVideo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const videoId = getYouTubeVideoId(url);
    if (!videoId || !supabase) { setError("URL YouTube tidak valid. Tempel tautan youtube.com atau youtu.be."); return; }
    const { error } = await supabase.from("publications").insert({ owner_id: profile.id, kind: "youtube", title: title.trim() || "Video YouTube", body: `https://www.youtube.com/watch?v=${videoId}`, visibility });
    if (error) setError(error.message); else { setUrl(""); setTitle(""); await load(); }
  };
  const deleteVideo = async (id: string) => {
    if (!supabase) return;
    const { error } = await supabase.from("publications").delete().eq("id", id);
    if (error) setError(error.message); else await load();
  };
  const toggleVideoVisibility = async (video: Publication) => {
    if (!supabase || video.owner_id !== profile.id || visibilityBusyId) return;
    const nextVisibility = video.visibility === "public" ? "private" : "public";
    setVisibilityBusyId(video.id);
    const { error } = await supabase.from("publications")
      .update({ visibility: nextVisibility })
      .eq("id", video.id)
      .eq("owner_id", profile.id)
      .eq("kind", "youtube")
      .select("id")
      .single();
    if (error) setError(error.message);
    else await load();
    setVisibilityBusyId(null);
  };
  return <>
    <PageHeading eyebrow="RGS VIDEO CHANNEL" title={<>YouTube<span className="title-dot">.</span></>} subtitle="Temukan video pilihan dan bagikan momen gaming kamu." />
    <form className="youtube-add" onSubmit={addVideo}><div className="youtube-add-heading"><div className="youtube-icon"><Youtube size={20} /></div><div><strong>Bagikan video YouTube</strong><span>Video Public terlihat semua anggota; Private hanya terlihat oleh kamu.</span></div></div><div className="youtube-form-fields"><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Tempel URL YouTube..." aria-label="URL YouTube" required /><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Judul video (opsional)" aria-label="Judul video" /><select className="filter-select" value={visibility} onChange={(event) => setVisibility(event.target.value === "private" ? "private" : "public")}><option value="public">Public</option><option value="private">Private</option></select><button className="button button-primary"><Plus size={16} /> Tambahkan</button></div><div className="converter-note"><CircleHelp size={14} /> Converter/download video tidak disediakan. Tonton atau buka video melalui YouTube sesuai ketentuan layanan.</div></form>
    <div className="section-heading"><div><span className="eyebrow">CURATED BY MEMBERS</span><h2>Video komunitas</h2></div><span className="member-count">{videos.length} video</span></div>
    <div className="video-grid">{videos.filter((video) => video.visibility === "public" || video.owner_id === profile.id).map((video) => { const videoId = getYouTubeVideoId(video.body); return <article className="video-card" key={video.id}><div className="video-frame">{videoId ? <YouTubePlayer videoId={videoId} title={video.title} /> : <div className="video-unavailable"><Film size={28} /></div>}</div>{videoId && <div className="video-card-link"><YouTubeWatchLink videoId={videoId} /></div>}<div className="video-info"><div><h3>{video.title}</h3><span>oleh {video.profiles?.nickname ?? "Member"} · {dateLabel(video.created_at)}</span></div>{video.owner_id === profile.id ? <button className={`visibility-chip ${video.visibility} visibility-toggle`} disabled={visibilityBusyId === video.id} onClick={() => void toggleVideoVisibility(video)} title={`Ubah menjadi ${video.visibility === "public" ? "Private" : "Public"}`} aria-label={`${video.title}: ${video.visibility}. Ubah menjadi ${video.visibility === "public" ? "Private" : "Public"}`}>{video.visibility === "public" ? <Globe2 size={13} /> : <LockKeyhole size={13} />}{visibilityBusyId === video.id ? "Menyimpan..." : video.visibility}</button> : <span className={`visibility-chip ${video.visibility}`}>{video.visibility === "public" ? <Globe2 size={13} /> : <LockKeyhole size={13} />}{video.visibility}</span>}{video.owner_id === profile.id && <button className="icon-button" title="Hapus publikasi" onClick={() => void deleteVideo(video.id)}><X size={16} /></button>}</div><Engagement targetType="publication" targetId={video.id} profileId={profile.id} setError={setError} /></article>; })}</div>
    {!videos.length && <EmptyState title="Belum ada video" body="Jadilah yang pertama membagikan video YouTube komunitas." />}
  </>;
}

function ChatPage({ profile, setError }: { profile: Profile; setError: (message: string) => void }) {
  const [messages, setMessages] = useState<Array<{ id: string; body: string; created_at: string; profiles?: { nickname: string; role: Role } }>>([]);
  const [text, setText] = useState("");
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from("chat_messages").select("id, body, created_at, profiles(nickname, role)").eq("room_id", "00000000-0000-0000-0000-000000000001").order("created_at", { ascending: true }).limit(100);
    if (error) { setError(error.message); return; }
    const normalized = Array.isArray(data) ? data.flatMap((item) => {
      const row = item as unknown as Record<string, unknown>;
      const joined = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      const author = joined && typeof joined === "object" ? joined as Record<string, unknown> : null;
      if (typeof row.id !== "string" || typeof row.body !== "string" || typeof row.created_at !== "string") return [];
      return [{ id: row.id, body: row.body, created_at: row.created_at, profiles: author && typeof author.nickname === "string" && isRole(author.role) ? { nickname: author.nickname, role: author.role } : undefined }];
    }) : [];
    setMessages(normalized);
  }, [setError]);
  useEffect(() => {
    if (!supabase) return;
    void load();
    const channel = supabase.channel("rgs-global-chat").on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, () => void load()).subscribe();
    return () => { void supabase?.removeChannel(channel); };
  }, [load]);
  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !text.trim()) return;
    const { error } = await supabase.from("chat_messages").insert({ room_id: "00000000-0000-0000-0000-000000000001", sender_id: profile.id, body: text.trim() });
    if (error) setError(error.message); else { setText(""); await load(); }
  };
  return <>
    <PageHeading eyebrow="SAY HELLO" title={<>Community chat<span className="title-dot">.</span></>} subtitle="Ruang obrolan umum RGS, live bersama komunitas." />
    <section className="chat-panel"><div className="chat-header"><div className="chat-room-icon"><MessageCircle size={18} /></div><div><strong># general</strong><span><i /> Ruang publik · {messages.length} pesan dimuat</span></div><button className="icon-button" title="Info"><MoreHorizontal size={19} /></button></div><div className="chat-messages">{messages.map((message) => <article className={`chat-message ${message.profiles?.nickname === profile.nickname ? "mine" : ""}`} key={message.id}><div className="chat-avatar">{(message.profiles?.nickname ?? "?").slice(0, 1).toUpperCase()}</div><div className="chat-message-content"><div><strong>{message.profiles?.nickname ?? "Member"} </strong>{message.profiles?.role && <RoleBadge role={message.profiles.role} />}<time>{new Date(message.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</time></div><p>{message.body}</p></div></article>)}</div><form className="chat-composer" onSubmit={send}><input value={text} onChange={(event) => setText(event.target.value)} placeholder="Kirim pesan ke #general..." maxLength={2000} /><button className="send-button" disabled={!text.trim()} aria-label="Kirim pesan"><Send size={17} /></button></form></section>
    <p className="chat-notice"><Shield size={14} /> Jaga ruang tetap nyaman. Jangan kirim password, data pribadi, atau informasi sensitif.</p>
  </>;
}

function ProfilePage({ profile, setProfile, setError }: { profile: Profile; setProfile: (profile: Profile) => void; setError: (message: string) => void }) {
  const [bio, setBio] = useState(profile.bio ?? "");
  const [saving, setSaving] = useState(false);
  const [publications, setPublications] = useState(0);
  const loadPublicationCount = useCallback(async () => {
    if (!supabase) return;
    const { count, error } = await supabase.from("publications").select("id", { count: "exact", head: true }).eq("owner_id", profile.id);
    if (error) setError(error.message); else setPublications(count ?? 0);
  }, [profile.id, setError]);
  useEffect(() => { void loadPublicationCount(); }, [loadPublicationCount]);
  useRealtimeRefresh("rgs-profile-publications", PUBLICATION_TABLE, loadPublicationCount, undefined, setError);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!supabase) return;
    setSaving(true);
    const { data, error } = await supabase.from("profiles").update({ bio: bio.trim() }).eq("id", profile.id).select("*").single();
    if (error) setError(error.message); else setProfile(data as Profile);
    setSaving(false);
  };
  const avatarUpload = async (event: FormEvent<HTMLInputElement>) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!supabase || !file) return;
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type) || file.size > 3 * 1024 * 1024) { setError("Avatar harus berupa PNG, JPEG, GIF, atau WebP dan maksimal 3 MB."); return; }
    const path = `${profile.id}/avatar-${Date.now()}`;
    const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (uploadError) { setError(uploadError.message); return; }
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    const { data: updated, error } = await supabase.from("profiles").update({ avatar_url: data.publicUrl }).eq("id", profile.id).select("*").single();
    if (error) setError(error.message); else setProfile(updated as Profile);
  };
  return <>
    <PageHeading eyebrow="YOUR IDENTITY" title={<>Profil saya<span className="title-dot">.</span></>} subtitle="Atur identitas yang terlihat oleh komunitas." />
    <section className="profile-card"><div className="profile-cover"><div className="cover-mark" /></div><div className="profile-main"><label className="profile-avatar-upload"><Avatar profile={profile} large /><input type="file" accept="image/*" onChange={(event) => void avatarUpload(event as unknown as FormEvent<HTMLInputElement>)} /><span><Upload size={14} /></span></label><div className="profile-info"><h2>{profile.nickname}</h2><RoleBadge role={profile.role} /><p>{profile.bio || "Belum ada bio. Ceritakan sedikit tentang dirimu."}</p><div className="profile-meta"><span>Member sejak {dateLabel(profile.created_at)}</span><span><Sparkles size={14} /> {publications} publikasi</span></div></div></div><form className="profile-edit" onSubmit={save}><label className="field"><span>Bio</span><textarea value={bio} onChange={(event) => setBio(event.target.value)} maxLength={240} rows={3} placeholder="Ceritakan tentang dirimu..." /></label><div className="profile-edit-footer"><span>{bio.length}/240 karakter · Nickname dikelola admin</span><button className="button button-primary" disabled={saving}><Check size={16} />{saving ? "Menyimpan..." : "Simpan profil"}</button></div></form></section>
  </>;
}

function InvitesPage({ profile, setError }: { profile: Profile; setError: (message: string) => void }) {
  const [invites, setInvites] = useState<Array<{ id: string; code: string; max_uses: number; used_count: number; expires_at: string | null; active: boolean }>>([]);
  const [maxUses, setMaxUses] = useState("5");
  const [createdCode, setCreatedCode] = useState("");
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from("invite_codes").select("id, code, max_uses, used_count, expires_at, active").order("created_at", { ascending: false });
    if (error) setError(error.message); else setInvites(data ?? []);
  }, [setError]);
  useEffect(() => { void load(); }, [load]);
  useRealtimeRefresh("rgs-invites", INVITE_TABLE, load, undefined, setError);
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!supabase) return;
    const { data, error } = await supabase.rpc("create_invite_code", { p_max_uses: Number(maxUses) });
    if (error) setError(error.message); else { setCreatedCode(data as string); await load(); }
  };
  const toggle = async (invite: (typeof invites)[number]) => {
    if (!supabase) return;
    const { error } = await supabase.from("invite_codes").update({ active: !invite.active }).eq("id", invite.id);
    if (error) setError(error.message); else await load();
  };
  const deleteInvite = async (invite: (typeof invites)[number]) => {
    if (!supabase || !window.confirm(`Hapus invite code ${invite.code}?`)) return;
    const { error } = await supabase.from("invite_codes").delete().eq("id", invite.id);
    if (error) setError(error.message); else await load();
  };
  return <>
    <PageHeading eyebrow="GROW THE COMMUNITY" title={<>Invite codes<span className="title-dot">.</span></>} subtitle="Undang gamer baru dengan kode yang memiliki batas penggunaan." />
    <form className="invite-create" onSubmit={create}><div><div className="invite-create-icon"><KeyRound size={20} /></div><strong>Buat kode undangan</strong><span>{profile.role === "owner" ? "Owner dapat membuat kode dengan batas pemakaian." : "Admin dapat membuat kode undangan terbatas."}</span></div><label className="field"><span>Batas penggunaan</span><input type="number" min="1" max="100" value={maxUses} onChange={(event) => setMaxUses(event.target.value)} /></label><button className="button button-primary"><Plus size={16} /> Buat kode</button></form>
    {createdCode && <div className="created-code"><div><span>KODE BERHASIL DIBUAT</span><strong>{createdCode}</strong></div><button className="button button-outline" onClick={() => void navigator.clipboard.writeText(createdCode)}><Link2 size={15} /> Salin</button></div>}
    <div className="section-heading"><div><span className="eyebrow">YOUR INVITATIONS</span><h2>Daftar kode</h2></div><span className="member-count">{invites.length} kode</span></div>
    <div className="invite-list">{invites.map((invite) => <div className="invite-row" key={invite.id}><div className="invite-key"><KeyRound size={16} /><strong>{invite.code}</strong></div><span className="invite-uses">{invite.used_count} / {invite.max_uses} digunakan</span><div className="invite-meter"><i style={{ width: `${Math.min(invite.used_count / invite.max_uses * 100, 100)}%` }} /></div><span className={`status-chip ${invite.active ? "active" : "inactive"}`}>{invite.active ? "Aktif" : "Nonaktif"}</span>{profile.role === "owner" && <><button className="button button-outline" onClick={() => void toggle(invite)}>{invite.active ? "Nonaktifkan" : "Aktifkan"}</button><button className="icon-button" title="Hapus kode" onClick={() => void deleteInvite(invite)}><X size={16} /></button></>}</div>)}</div>
    {!invites.length && <EmptyState title="Belum ada kode undangan" body="Buat kode pertama untuk mengundang anggota baru." />}
  </>;
}

function NotificationsPage({ setError }: { setError: (message: string) => void }) {
  const [notifications, setNotifications] = useState<Array<{ id: string; title: string; body: string; created_at: string; read_at: string | null }>>([]);
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from("notifications").select("id, title, body, created_at, read_at").order("created_at", { ascending: false }).limit(50);
    if (error) setError(error.message); else setNotifications(data ?? []);
  }, [setError]);
  useEffect(() => { void load(); }, [load]);
  useRealtimeRefresh("rgs-notifications", NOTIFICATION_TABLE, load, undefined, setError);
  const markRead = async (id: string) => {
    if (!supabase) return;
    const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
    if (error) return;
    setNotifications((current) => current.map((item) => item.id === id ? { ...item, read_at: new Date().toISOString() } : item));
  };
  return <>
    <PageHeading eyebrow="STAY IN THE LOOP" title={<>Notifications<span className="title-dot">.</span></>} subtitle="Pemberitahuan penting dari aktivitas komunitas." />
    <div className="notification-list">{notifications.map((item) => <article className={`notification-row ${item.read_at ? "" : "unread"}`} key={item.id}><div className="notification-icon"><Bell size={17} /></div><div><strong>{item.title}</strong><p>{item.body}</p><time>{dateLabel(item.created_at)}</time></div>{!item.read_at && <button className="text-button" onClick={() => void markRead(item.id)}>Tandai dibaca</button>}</article>)}</div>
    {!notifications.length && <EmptyState title="Semua tenang di sini" body="Notifikasi komunitas akan muncul di halaman ini." />}
  </>;
}

function SettingsPage() {
  return <>
    <PageHeading eyebrow="OWNER CONTROL" title={<>Settings<span className="title-dot">.</span></>} subtitle="Informasi layanan dan pengaturan dasar workspace." />
    <section className="settings-card"><div className="settings-icon"><Shield size={19} /></div><div><strong>Security & permissions</strong><p>Role dan akses data diproteksi dengan kebijakan PostgreSQL Row Level Security di Supabase.</p></div><span className="status-chip active">RLS aktif</span></section>
    <section className="settings-card"><div className="settings-icon"><Folder size={19} /></div><div><strong>File & upload limits</strong><p>Batas upload antarmuka saat ini 25 MB per file. Batas bucket juga harus diatur di Supabase Dashboard.</p></div><span className="status-chip active">25 MB / file</span></section>
    <section className="settings-card"><div className="settings-icon"><CircleHelp size={19} /></div><div><strong>Owner provisioning</strong><p>Akun owner pertama hanya dapat dipromosikan menggunakan SQL Editor service role sesuai panduan README.</p></div><span className="status-chip inactive">Manual</span></section>
  </>;
}

function PublicationCard({ post, profileId, onDelete, setError }: { post: Publication; profileId: string; onDelete: () => void | Promise<void>; setError: (message: string) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const canDelete = post.owner_id === profileId;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/#publication-${post.id}`);
      setMenuOpen(false);
    } catch (error) {
      setError(friendlyError(error));
    }
  };
  const deletePublication = async () => {
    if (!supabase || !canDelete || !window.confirm("Hapus publikasi ini? Tindakan ini tidak dapat dibatalkan.")) return;
    const { error } = await supabase.from("publications").delete().eq("id", post.id);
    if (error) { setError(error.message); return; }
    setMenuOpen(false);
    await onDelete();
  };

  const videoId = post.kind === "youtube" ? getYouTubeVideoId(post.body) : null;
  return <article className="post-card" id={`publication-${post.id}`}><header className="post-header"><Avatar profile={{ nickname: post.profiles?.nickname ?? "Member", avatar_url: post.profiles?.avatar_url ?? null }} /><div className="post-author"><strong>{post.profiles?.nickname ?? "Member"} <RoleBadge role={post.profiles?.role ?? "user"} /></strong><span>{dateLabel(post.created_at)} · {post.kind === "youtube" ? "Video YouTube" : "Publikasi"}</span></div><div className="post-menu-wrap"><button className="icon-button post-more" aria-label={`Opsi publikasi ${post.title}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={19} /></button>{menuOpen && <div className="post-menu" role="menu"><button role="menuitem" onClick={() => void copyLink()}><Copy size={14} />Salin tautan</button>{canDelete && <button className="danger-action" role="menuitem" onClick={() => void deletePublication()}><Trash2 size={14} />Hapus publikasi</button>}</div>}</div></header><div className="post-content"><h3>{post.title}</h3>{videoId ? <><div className="post-video-frame"><YouTubePlayer videoId={videoId} title={post.title} /></div><YouTubeWatchLink videoId={videoId} /></> : <p>{post.body}</p>}</div><Engagement targetType="publication" targetId={post.id} profileId={profileId} setError={setError} /></article>;
}

function Engagement({ targetType, targetId, profileId, setError }: { targetType: "publication" | "file"; targetId: string; profileId: string; setError: (message: string) => void }) {
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(0);
  const [commentCount, setCommentCount] = useState(0);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<Array<{ id: string; body: string; created_at: string; nickname: string }>>([]);
  const [commentText, setCommentText] = useState("");
  const targetColumn = targetType === "publication" ? "publication_id" : "file_id";
  const reactionTable = targetType === "publication" ? "publication_reactions" : "file_reactions";
  const commentTable = targetType === "publication" ? "publication_comments" : "file_comments";
  const tables = targetType === "publication" ? ENGAGEMENT_TABLES : FILE_ENGAGEMENT_TABLES;

  const refreshCounts = useCallback(async () => {
    if (!supabase) return;
    const [reactions, ownReaction, count] = await Promise.all([
      supabase.from(reactionTable).select("user_id", { count: "exact", head: true }).eq(targetColumn, targetId),
      supabase.from(reactionTable).select("user_id").eq(targetColumn, targetId).eq("user_id", profileId).maybeSingle(),
      supabase.from(commentTable).select("id", { count: "exact", head: true }).eq(targetColumn, targetId),
    ]);
    const error = reactions.error ?? ownReaction.error ?? count.error;
    if (error) { setError(error.message); return; }
    setLikes(reactions.count ?? 0);
    setLiked(Boolean(ownReaction.data));
    setCommentCount(count.count ?? 0);
  }, [commentTable, profileId, reactionTable, setError, targetColumn, targetId]);

  useEffect(() => { void refreshCounts(); }, [refreshCounts]);

  const loadComments = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from(commentTable).select("id, body, created_at, profiles(nickname)").eq(targetColumn, targetId).order("created_at", { ascending: true }).limit(50);
    if (error) { setError(error.message); return; }
    const normalized = (data ?? []).flatMap((value) => {
      const row = value as unknown as Record<string, unknown>;
      const joined = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      const author = joined && typeof joined === "object" ? joined as Record<string, unknown> : null;
      if (typeof row.id !== "string" || typeof row.body !== "string" || typeof row.created_at !== "string") return [];
      return [{ id: row.id, body: row.body, created_at: row.created_at, nickname: author && typeof author.nickname === "string" ? author.nickname : "Member" }];
    });
    setComments(normalized);
    setCommentCount(normalized.length);
  }, [commentTable, setError, targetColumn, targetId]);

  const refreshEngagement = useCallback(async () => {
    await refreshCounts();
    if (commentsOpen) await loadComments();
  }, [commentsOpen, loadComments, refreshCounts]);
  useRealtimeRefresh(`rgs-engagement-${targetType}-${targetId}`, tables, refreshEngagement, `${targetColumn}=eq.${targetId}`, setError);

  const toggleLike = async () => {
    if (!supabase) return;
    const response = liked
      ? await supabase.from(reactionTable).delete().eq(targetColumn, targetId).eq("user_id", profileId)
      : await supabase.from(reactionTable).insert({ [targetColumn]: targetId, user_id: profileId });
    if (response.error) setError(response.error.message);
    else await refreshCounts();
  };

  const addComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !commentText.trim()) return;
    const { error } = await supabase.from(commentTable).insert({ [targetColumn]: targetId, user_id: profileId, body: commentText.trim() });
    if (error) setError(error.message);
    else { setCommentText(""); await loadComments(); }
  };

  return <><footer className="post-actions"><button className={`post-action ${liked ? "reacted" : ""}`} aria-label={liked ? "Batalkan apresiasi" : "Beri apresiasi"} onClick={() => void toggleLike()}><Sparkles size={16} /><span>Apresiasi {likes ? likes : ""}</span></button><button className="post-action" aria-expanded={commentsOpen} onClick={() => { const next = !commentsOpen; setCommentsOpen(next); if (next) void loadComments(); }}><MessageCircle size={16} /><span>Diskusi {commentCount ? commentCount : ""}</span></button></footer>{commentsOpen && <section className="comments-panel"><div className="comments-list">{comments.map((comment) => <div className="comment-row" key={comment.id}><strong>{comment.nickname}</strong><span>{comment.body}</span><time>{new Date(comment.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</time></div>)}{!comments.length && <span className="comments-empty">Belum ada diskusi. Mulai percakapan yang baik.</span>}</div><form className="comment-form" onSubmit={addComment}><input value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="Tulis komentar..." maxLength={1000} /><button className="icon-button" disabled={!commentText.trim()} aria-label="Kirim komentar"><Send size={15} /></button></form></section>}</>;
}

function YouTubePlayer({ videoId, title }: { videoId: string; title: string }) {
  const playerUrl = new URL(`https://www.youtube-nocookie.com/embed/${videoId}`);
  playerUrl.searchParams.set("enablejsapi", "1");
  playerUrl.searchParams.set("origin", window.location.origin);
  playerUrl.searchParams.set("playsinline", "1");
  playerUrl.searchParams.set("rel", "0");
  return <iframe src={playerUrl.toString()} title={title} loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" referrerPolicy="origin" allowFullScreen />;
}

function YouTubeWatchLink({ videoId }: { videoId: string }) {
  return <a className="video-open-link" href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noopener noreferrer"><Youtube size={13} />Buka di YouTube<ArrowUpRight size={12} /></a>;
}

function PageHeading({ eyebrow, title, subtitle, action }: { eyebrow: string; title: React.ReactNode; subtitle: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>;
}
function RoleBadge({ role }: { role: Role }) {
  return <span className={`role-badge ${role}`}><i />{role.toUpperCase()}</span>;
}
function Avatar({ profile, large = false }: { profile: { nickname: string; avatar_url?: string | null }; large?: boolean }) {
  return <span className={`avatar ${large ? "avatar-large" : ""}`}>{profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : profile.nickname.slice(0, 1).toUpperCase()}</span>;
}
function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty-state"><div><FileImage size={21} /></div><strong>{title}</strong><p>{body}</p></div>;
}
function LoadingLine() { return <div className="loading-line"><span /> Memuat publikasi...</div>; }
function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024; let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${value.toFixed(1)} ${units[index]}`;
}

export default App;
