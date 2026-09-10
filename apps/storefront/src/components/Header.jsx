import { useContext, useState } from "react";
import { useLocation } from "react-router-dom";
import { navigateTo, SiteChromeContext } from "@mirwal/shared/navigation";
import { useSession } from "./useSession";
import Dropdown from "./Dropdown";
import "./header-redesign.css";

const FaIcon = ({ name }) => (
  <i className={`fa-solid fa-${name}`} aria-hidden="true" />
);
function navigate(path) {
  navigateTo(path);
}

export default function Header({
  cartCount = 0,
  showNav = true,
  global = false,
}) {
  // Previously defaulted to `true` and was never passed, so every visitor — signed in or not —
  // was shown a stock avatar and the name "Umar". Then it read a self-asserted role out of
  // localStorage (see PROJECT_AUDIT.md S21) instead of a real session. Now it reflects
  // `useSession()`, which only ever holds a server-verified user.
  const { user } = useSession();
  const isLoggedIn = Boolean(user);
  const accountName = user?.fullName?.trim() || "Account";
  const accountInitial = accountName.charAt(0).toUpperCase();
  const accountImage = user?.avatarUrl || user?.imageUrl || user?.profileImageUrl;
  const [category, setCategory] = useState("All Categories");
  const [location, setLocation] = useState("Lahore, Pakistan");
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname: currentPath } = useLocation();
  const chromeIsMounted = useContext(SiteChromeContext);
  if (chromeIsMounted && !global) return null;
  const categories = [
    "All Categories",
    "Electronics",
    "Home & Living",
    "Fashion",
    "Beauty & Health",
  ];
  // Trimmed from 10 links to the 5 a shopper reaches for most often. The other five —
  // Brands, Sellers, Guides, Featured, Contact — aren't removed, only demoted: every one of
  // them is already a real link in the footer's Marketplace/Company sections, one scroll
  // away, so nothing became unreachable. Ten equally-weighted top-level links left nothing
  // looking more important than anything else, which is its own hierarchy problem.
  const navItems = [
    ["house", "Home", "/"],
    ["layer-group", "Categories", "/categories"],
    ["grip", "Explore", "/explore"],
    ["tag", "Deals", "/deals"],
    ["scale-balanced", "Compare", "/compare"],
  ];
  return (
    <div className="site-header">
      <div className="site-utility">
        <div className="site-utility-inner">
          <Dropdown
            className="location-menu"
            toggleClassName="site-utility-link"
            label={<><FaIcon name="location-dot" /> Delivering to <strong>{location}</strong></>}
          >
            {["Lahore, Pakistan", "Karachi, Pakistan", "Islamabad, Pakistan"].map((city) => (
              <li key={city}>
                <button type="button" className="dropdown-item" onClick={() => setLocation(city)}>
                  {city}
                </button>
              </li>
            ))}
          </Dropdown>
          <span className="site-promise">
            <FaIcon name="wand-magic-sparkles" /> Smart Shopping, Better Living
          </span>
          <div className="site-utility-actions">
            <button type="button" onClick={() => navigate("/sell-with-mirwal")}>
              <FaIcon name="store" /> Become a Seller
            </button>
            <button type="button" onClick={() => navigate("/help-center")}>
              <FaIcon name="headset" /> Help &amp; Support
            </button>
            <button type="button" onClick={() => navigate("/track-orders")}>
              <FaIcon name="box" /> Track Order
            </button>
          </div>
        </div>
      </div>
      <header className="site-main-header container">
        <button
  className="site-brand"
  type="button"
  onClick={() => navigate("/")}
>
  <img
    src="/mirwal-word-logo.png"
    alt="Mirwal"
    className="site-brand-logo"
  />
</button>
        <form
          className="site-search"
          onSubmit={(event) => {
            event.preventDefault();
            const value = search.trim();
            navigate(value ? `/search?q=${encodeURIComponent(value)}` : "/explore");
          }}
        >
          <Dropdown
            className="site-search-category"
            toggleClassName="site-search-category-button"
            label={<><FaIcon name="layer-group" /><span>{category}</span></>}
          >
            {categories.map((item) => (
              <li key={item}>
                <button
                  type="button"
                  className="dropdown-item"
                  onClick={() => { setCategory(item); if (item !== "All Categories") navigate(`/explore?category=${encodeURIComponent(item)}`) }}
                >
                  {item}
                </button>
              </li>
            ))}
          </Dropdown>
          <FaIcon name="magnifying-glass" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search products, brands or solve your shopping problem..."
            aria-label="Search products"
          />
          <button type="submit" aria-label="Search">
            <FaIcon name="magnifying-glass" />
          </button>
        </form>
        <button
          className="site-menu-toggle"
          type="button"
          aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <FaIcon name={menuOpen ? "xmark" : "bars"} />
        </button>
        <div className="site-actions">
          <button type="button" onClick={() => navigate("/ai-shopping")}>
            <span>
              <FaIcon name="robot" />
            </span>
            <small>AI Shopping</small>
          </button>
          <button type="button" onClick={() => navigate("/wishlist")}>
            <span>
              <FaIcon name="heart" />
            </span>
            <small>Wishlist</small>
          </button>
          <button type="button" onClick={() => navigate("/cart")}>
            <span>
              <FaIcon name="cart-shopping" />
              {cartCount > 0 && <i className="action-badge">{cartCount}</i>}
            </span>
            <small>Cart</small>
          </button>
          {isLoggedIn ? (
            <Dropdown
              className="site-user-menu"
              toggleClassName="site-user"
              menuClassName="dropdown-menu-end"
              label={<>
                {accountImage ? <img src={accountImage} alt="" className="site-user-avatar" /> : <span className="site-user-initial" aria-hidden="true">{accountInitial}</span>}
                <span>{accountName}</span>
              </>}
            >
              {[
                ["user", "My Profile", "/profile"],
                ["box", "My Orders", "/orders"],
                ["gear", "Settings", "/settings"],
              ].map(([icon, label, path]) => (
                <li key={path}>
                  <button type="button" className="dropdown-item" onClick={() => navigate(path)}>
                    <FaIcon name={icon} /> {label}
                  </button>
                </li>
              ))}
              <li><hr className="dropdown-divider" /></li>
              <li>
                <button type="button" className="dropdown-item" onClick={() => navigate("/logout")}>
                  <FaIcon name="right-from-bracket" /> Logout
                </button>
              </li>
            </Dropdown>
          ) : (
            <button
              className="site-sign-in"
              type="button"
              onClick={() => navigate("/login")}
            >
              <FaIcon name="user" /> Sign In
            </button>
          )}
        </div>
      </header>
      {showNav && (
        <nav className={`site-nav${menuOpen ? " open" : ""}`}>
          <div className="site-nav-inner container">
            <div className="site-nav-links">
              {navItems.map(([icon, label, path]) => (
                <button
                  type="button"
                  className={currentPath === path ? "active" : ""}
                  key={label}
                  onClick={() => navigate(path)}
                >
                  <FaIcon name={icon} /> {label}
                  {label === "AI Solution" && <em>New</em>}
                </button>
              ))}
            </div>
            {isLoggedIn ? (
              <button
                className="site-account-button"
                type="button"
                onClick={() => navigate("/profile")}
              >
                <FaIcon name="user" /> My Account
              </button>
            ) : (
              <button
                className="site-account-button"
                type="button"
                onClick={() => navigate("/login")}
              >
                <FaIcon name="user" /> Login / Register
              </button>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
