import { useState } from "react";

const sections = [
  ["", [["dashboard", "Dashboard", "house", "/"]]],
  [
    "PRODUCTS",
    [
      ["all-products", "My Products", "box", "/products"],
      ["add-product", "Add New Product", "plus-circle", "/products/add"],
      ["categories", "Categories", "layer-group", "/categories"],
      ["brands", "Brands", "tags", "/brands"],
      ["reviews", "Product Reviews", "star", "/reviews"],
    ],
  ],
  [
    "ORDERS",
    [
      ["all-orders", "Orders", "box", "/orders"],
      ["customers", "Customers", "users", "/customers"],
      ["returns", "Returns & Refunds", "rotate-left", "/orders/returns"],
      [
        "cancelled",
        "Cancellations",
        "circle-xmark",
        "/orders/cancelled",
      ],
    ],
  ],
  [
    "FINANCE",
    [
      ["overview", "Overview", "chart-line", "/finance"],
      [
        "withdrawals",
        "Withdrawals",
        "money-bill-transfer",
        "/finance/withdrawals",
      ],
      [
        "payment-methods",
        "Payment Settings",
        "credit-card",
        "/finance/settings",
      ],
    ],
  ],
  [
    "MARKETING",
    [
      [
        "marketing-overview",
        "Marketing Overview",
        "chart-line",
        "/marketing",
      ],
      ["promotions", "Promotions", "bullhorn", "/marketing/promotions"],
      ["discounts", "Discounts", "tag", "/marketing/discounts"],
      ["coupons", "Coupons", "ticket", "/marketing/coupons"],
      ["ads", "Ads Campaigns", "rectangle-ad", "/marketing/ads"],
      [
        "recommendations",
        "Recommendations",
        "wand-magic-sparkles",
        "/marketing/recommendations",
      ],
      [
        "performance",
        "Marketing Performance",
        "chart-line",
        "/marketing/performance",
      ],
    ],
  ],
  [
    "SHOP MANAGEMENT",
    [
      ["store-profile", "Store Profile", "store", "/store/profile"],
      // Sits with the store rather than with orders: it describes the store as a whole, and a
      // seller who has just been warned looks for it here.
      ["performance-page", "Performance", "gauge-high", "/performance"],
      [
        "shipping-settings",
        "Shipping Settings",
        "truck",
        "/store/shipping",
      ],
      ["store-settings", "Store Settings", "gear", "/store/settings"],
    ],
  ],
  [
    "SUPPORT",
    [
      ["support-page", "Help Center", "circle-question", "/help"],
      ["seller-support", "Seller Support", "headset", "/support"],
    ],
  ],
];

const STATUS_LABEL = { approved: "Verified Seller", pending: "Application Pending", suspended: "Suspended", rejected: "Application Rejected" };

const SellerSidebar = ({ activeItem, onNavigate, mobileOpen, onClose, openOrderCount, store }) => {
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem("mirwal-seller-collapsed") === "true");
  const toggleCollapsed = () => setCollapsed((value) => {
    const next = !value;
    window.localStorage.setItem("mirwal-seller-collapsed", String(next));
    return next;
  });
  const navigate = (path) => {
    onNavigate(path);
    onClose?.();
  };
  return (
    <aside
      className={`seller-sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}
    >
      <div className="seller-sidebar-brand">
  <div className="seller-brand-content">
    <img
      src="/mirwal-word-logo.png"
      alt="Mirwal"
      className="seller-brand-logo"
    />
    <small>All finds. You choose.</small>
  </div>

  <button
    type="button"
    onClick={toggleCollapsed}
    aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
    className="seller-collapse-btn"
  >
    <i className={`fa-solid fa-angles-${collapsed ? "right" : "left"}`} />
  </button>

  <button
    type="button"
    onClick={onClose}
    aria-label="Close navigation"
    className="seller-close-btn"
  >
    <i className="fa-solid fa-xmark" />
  </button>
</div>
      <button type="button" className="seller-store-badge" onClick={() => navigate("/")}>
        <span>
          <i className="fa-solid fa-store" />
        </span>
        <div>
          <b>{store?.name || "Your store"}</b>
          <small>{STATUS_LABEL[store?.status] ?? "Seller"}</small>
        </div>
      </button>
      <nav className="seller-nav" aria-label="Seller navigation">
        {sections.map(([title, items]) => (
          <section className="seller-nav-section" key={title}>
            {title && <h2>{title}</h2>}
            {items.map(([id, label, icon, path]) => (
              <button
                className={`seller-nav-item ${activeItem === id ? "active" : ""}`}
                type="button"
                key={id}
                onClick={() => navigate(path)}
              >
                <i className={`fa-solid fa-${icon}`} />
                <span>{label}</span>
                {id === "all-orders" && openOrderCount > 0 && <em>{openOrderCount}</em>}
              </button>
            ))}
          </section>
        ))}
      </nav>
      <button
        className="seller-view-store"
        type="button"
        onClick={() => navigate("/store")}
      >
        View Store <i className="fa-solid fa-arrow-up-right-from-square" />
      </button>
    </aside>
  );
};

export default SellerSidebar;
