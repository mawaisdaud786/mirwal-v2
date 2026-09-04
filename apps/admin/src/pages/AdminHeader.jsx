import { useEffect, useRef, useState } from "react";
import { navigateTo } from "@mirwal/shared/navigation";
import { useAdminSession } from "../AdminSession";
import { describeApiError } from "@mirwal/shared/useApiQuery";

/**
 * The theme toggle had no click handler at all — a button that visibly does nothing on
 * click, the exact "decorative control pretending to work" this redesign was told to remove.
 * Admin has no dark theme built (every admin/seller stylesheet uses fixed light colors), so
 * it now matches the notifications bell's honest pattern: disabled, with a tooltip saying so,
 * instead of a silent no-op.
 *
 * The profile button previously just navigated to `/admin` — there was no way to sign out of
 * the admin panel at all. It now opens a real menu with a working logout that calls
 * `useAdminSession().logout()` (revokes the refresh token server-side), the same real sign-out
 * every other part of the app uses.
 */
export default function AdminHeader({ onMenu }) {
  const { user, logout } = useAdminSession();
  const adminName = user?.fullName?.trim() || "Admin";
  const adminInitials = adminName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const menuRef = useRef(null);

  useEffect(() => {
    const close = (event) => { if (!menuRef.current?.contains(event.target)) setMenuOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const submit = (event) => {
    event.preventDefault();
    if (query.trim()) navigateTo(`/search?query=${encodeURIComponent(query.trim())}`);
  };

  const confirmLogout = async () => {
    setLoggingOut(true); setLogoutError("");
    try { await logout(); navigateTo("/login"); }
    catch (error) { setLogoutError(describeApiError(error)); setLoggingOut(false); }
  };

  return (
    <header className="admin-header">
      <button type="button" className="admin-menu" aria-label="Open navigation" onClick={onMenu}>
        <i className="fa-solid fa-bars" />
      </button>
      <form className="admin-search" onSubmit={submit}>
        <i className="fa-solid fa-magnifying-glass" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search anything..."
          aria-label="Search admin panel"
        />
        <kbd>Ctrl + K</kbd>
      </form>
      <div className="admin-header-actions">
        {/* The dark-theme toggle is gone rather than left permanently disabled. The admin
            panel has one theme; a switch that never switches anything is worse than no
            switch, because it keeps promising a setting that does not exist. */}
        <button type="button" aria-label="Notifications" title="Notifications" onClick={() => navigateTo("/notifications")}>
          <i className="fa-regular fa-bell" />
        </button>
        <div className="admin-profile-wrap" ref={menuRef}>
          <button
            type="button"
            className="admin-profile"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <span>{adminInitials || "?"}</span>
            <div>
              <strong>{adminName}</strong>
              <small>{user?.roles?.includes("super_admin") ? "Super Administrator" : "Administrator"}</small>
            </div>
            <i className="fa-solid fa-chevron-down" />
          </button>
          {menuOpen && (
            <div className="admin-profile-menu">
              <button type="button" onClick={() => { setMenuOpen(false); navigateTo("/settings"); }}>
                <i className="fa-solid fa-gear" /> Settings
              </button>
              <hr />
              <button type="button" className="admin-profile-menu-danger" onClick={() => { setMenuOpen(false); setLogoutOpen(true); }}>
                <i className="fa-solid fa-right-from-bracket" /> Log out
              </button>
            </div>
          )}
        </div>
      </div>

      {logoutOpen && (
        <div className="admin-modal-backdrop" role="presentation" onMouseDown={() => !loggingOut && setLogoutOpen(false)}>
          <div className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-logout-title" onMouseDown={(event) => event.stopPropagation()}>
            <h2 id="admin-logout-title">Log out of the admin panel?</h2>
            <p>You'll need to sign in again to make changes.</p>
            {logoutError && <p className="admin-modal-error">{logoutError}</p>}
            <div className="admin-modal-actions">
              <button type="button" className="admin-btn-secondary" onClick={() => setLogoutOpen(false)} disabled={loggingOut}>Cancel</button>
              <button type="button" className="admin-btn-danger" onClick={confirmLogout} disabled={loggingOut}>{loggingOut ? "Logging out…" : "Log out"}</button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
