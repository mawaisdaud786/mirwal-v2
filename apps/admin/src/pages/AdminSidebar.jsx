import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

const groups = [
  [
    "OVERVIEW",
    [
      ["Dashboard", "gauge-high", "/"],
      ["Analytics Overview", "chart-line", "/analytics"],
      ["Notifications", "bell", "/notifications"],
    ],
  ],
  [
    "MARKETPLACE",
    [
      ["Products", "box", "/products"],
      ["Categories", "layer-group", "/categories"],
      ["Brands", "tags", "/brands"],
      ["Attributes", "sliders", "/attributes"],
      ["Inventory", "boxes-stacked", "/inventory"],
      ["Product Approvals", "clipboard-check", "/product-approvals"],
      ["Product Reports", "flag", "/product-reports"],
    ],
  ],
  [
    "SELLERS",
    [
      ["All Sellers", "users", "/sellers"],
      ["Applications", "user-plus", "/seller-applications"],
      ["Verification", "user-shield", "/verification"],
      ["Seller Performance", "chart-column", "/seller-performance"],
      ["Payouts", "money-bill-transfer", "/payouts"],
    ],
  ],
  [
    "STORES",
    [
      ["All Stores", "store", "/stores"],
      ["Store Applications", "shop", "/store-applications"],
    ],
  ],
  [
    "CUSTOMERS",
    [
      ["All Customers", "user-group", "/customers"],
      ["Reviews", "star", "/reviews"],
      ["Support Tickets", "life-ring", "/complaints"],
      ["Blocked Accounts", "user-lock", "/blocked-accounts"],
    ],
  ],
  [
    "ORDERS",
    [
      ["All Orders", "bag-shopping", "/orders"],
      ["Returns", "rotate-left", "/returns"],
      ["Refunds", "arrow-rotate-left", "/refunds"],
      // Two entries, deliberately. "Disputes" is the read-only overview of every return on
      // the marketplace; "Escalated Returns" is the queue Mirwal actually decides, on its own
      // permission, because overturning a seller moves money away from them.
      ["Disputes", "scale-balanced", "/disputes"],
      ["Escalated Returns", "gavel", "/return-disputes"],
      ["Trust & Safety", "shield-halved", "/cases"],
    ],
  ],
  [
    "MIRWAL AI",
    [
      ["AI Overview", "robot", "/ai"],
      ["Shopping Queries", "magnifying-glass", "/ai/queries"],
      ["Recommendations", "wand-magic-sparkles", "/ai/recommendations"],
      ["Comparisons", "code-compare", "/ai/comparisons"],
      ["AI Analytics", "brain", "/ai/analytics"],
    ],
  ],
  [
    "MARKETING & GROWTH",
    [
      ["Promotions", "bullhorn", "/promotions"],
      ["Campaigns", "rectangle-ad", "/campaigns"],
      ["Coupons", "ticket", "/coupons"],
      ["Flash Sales", "bolt", "/flash-sales"],
      ["Banners", "images", "/banners"],
      ["Financial Sections", "chart-pie", "/financial-sections"],
    ],
  ],
  [
    "FINANCES",
    [
      ["Finances", "wallet", "/finances"],
      ["Business Analytics", "chart-line", "/business-analytics"],
      ["Marketplace Analytics", "chart-column", "/marketplace-analytics"],
      ["Seller Analytics", "chart-area", "/seller-analytics"],
      ["Customer Analytics", "users", "/customer-analytics"],
      ["AI Analytics", "brain", "/ai/analytics"],
    ],
  ],
  [
    "ADMINISTRATION",
    [
      ["Admin Users", "user-gear", "/users"],
      ["Roles & Permissions", "user-shield", "/roles"],
      ["Teams", "users-gear", "/teams"],
      ["Access Control", "key", "/access-control"],
      ["Login Sessions", "right-to-bracket", "/sessions"],
      ["Admin Activity", "clock-rotate-left", "/activity"],
      ["Audit Logs", "file-shield", "/audit-logs"],
    ],
  ],
  [
    "SYSTEM",
    [
      ["General Settings", "gear", "/settings"],
      ["Platform Settings", "sliders", "/platform-settings"],
      ["Payment Settings", "credit-card", "/payment-settings"],
      ["Shipping & Delivery", "truck", "/shipping"],
      ["Tax & Commission", "percent", "/tax"],
      ["Email & SMS", "envelope", "/messaging"],
      ["Notifications", "bell", "/notifications"],
      ["Integrations", "plug", "/integrations"],
      ["API & Webhooks", "code", "/api"],
      ["AI Configuration", "robot", "/ai/configuration"],
      ["Search Configuration", "magnifying-glass", "/search"],
      ["Security", "shield-halved", "/security"],
      ["System Logs", "list", "/system-logs"],
      ["Error Logs", "triangle-exclamation", "/error-logs"],
      ["Backup & Restore", "database", "/backup"],
      ["Maintenance Mode", "screwdriver-wrench", "/maintenance"],
    ],
  ],
];

export default function AdminSidebar({
  mobileOpen,
  onCollapse,
  onNavigate,
  onClose,
}) {
  const { pathname } = useLocation();
  const [openGroups, setOpenGroups] = useState(() => {
    try {
      const saved = JSON.parse(
        window.localStorage.getItem("mirwal-admin-open-groups"),
      );
      return new Set(
        Array.isArray(saved)
          ? saved
          : [
              "OVERVIEW",
              "MARKETPLACE",
              "SELLERS",
              "CUSTOMERS",
              "ORDERS",
              "MIRWAL AI",
            ],
      );
    } catch {
      return new Set([
        "OVERVIEW",
        "MARKETPLACE",
        "SELLERS",
        "CUSTOMERS",
        "ORDERS",
        "MIRWAL AI",
      ]);
    }
  });

  useEffect(() => {
    window.localStorage.setItem(
      "mirwal-admin-open-groups",
      JSON.stringify([...openGroups]),
    );
  }, [openGroups]);

  const toggleGroup = (title) =>
    setOpenGroups((current) => {
      const next = new Set(current);
      next.has(title) ? next.delete(title) : next.add(title);
      return next;
    });

  // With 60+ nav items across 11 groups, finding one by scrolling is exactly the "hard to
  // scan" problem the redesign was meant to fix. A real, local filter — every group that has
  // a match auto-expands so the result is actually visible, not just present in the DOM.
  const [filter, setFilter] = useState("");
  const normalizedFilter = filter.trim().toLowerCase();
  const filteredGroups = normalizedFilter
    ? groups
        .map(([title, items]) => [title, items.filter(([label]) => label.toLowerCase().includes(normalizedFilter))])
        .filter(([, items]) => items.length > 0)
    : groups;

  return (
    <aside className={`admin-sidebar ${mobileOpen ? "mobile-open" : ""}`}>
      <div className="admin-brand">
  <img
    src="/mirwal-word-logo-dark.png"
    alt="Mirwal"
    className="admin-brand-logo"
  />

  <div className="admin-brand-info">
    <small>Super Admin Panel</small>
  </div>

  <button
    type="button"
    aria-label="Close navigation"
    onClick={onClose}
  >
    <i className="fa-solid fa-xmark" />
  </button>
</div>
      <label className="admin-nav-filter">
        <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
        <input
          type="text"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter navigation…"
          aria-label="Filter admin navigation"
        />
        {filter && <button type="button" aria-label="Clear filter" onClick={() => setFilter("")}><i className="fa-solid fa-xmark" /></button>}
      </label>
      <nav aria-label="Super admin navigation">
        {filteredGroups.length === 0 && <p className="admin-nav-empty">No matches for "{filter}".</p>}
        {filteredGroups.map(([title, items]) => (
          <section key={title}>
            <button
              type="button"
              className="admin-group-toggle"
              aria-expanded={normalizedFilter ? true : openGroups.has(title)}
              onClick={() => toggleGroup(title)}
            >
              <h2>{title}</h2>
              <i
                className={`fa-solid fa-chevron-${(normalizedFilter || openGroups.has(title)) ? "down" : "right"}`}
              />
            </button>
            {(normalizedFilter || openGroups.has(title)) &&
              items.map(([label, icon, path, badge]) => (
                <button
                  type="button"
                  key={`${title}-${label}`}
                  className={`admin-nav-item ${pathname === path || (path !== "/" && pathname.startsWith(`${path}/`)) ? "active" : ""}`}
                  onClick={() => {
                    onNavigate(path);
                    onClose();
                  }}
                >
                  <i className={`fa-solid fa-${icon}`} />
                  <span>{label}</span>
                  {badge && <em>{badge}</em>}
                </button>
              ))}
          </section>
        ))}
      </nav>
      <div className="admin-sidebar-footer">
        <button type="button" onClick={onCollapse}>
          <i className="fa-solid fa-chevron-left" />
          <span>Collapse</span>
        </button>
      </div>
    </aside>
  );
}
