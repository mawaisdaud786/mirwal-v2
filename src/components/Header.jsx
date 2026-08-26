import { useContext, useState } from "react";
import { useLocation } from "react-router-dom";
import { navigateTo, SiteChromeContext } from "../navigation";
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
  isLoggedIn = true,
  global = false,
}) {
  const [category, setCategory] = useState("All Categories");
  const [location, setLocation] = useState("Lahore, Pakistan");
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
  const navItems = [
    ["house", "Home", "/"],
    ["grip", "Explore", "/explore"],
    ["tag", "Deals", "/deals"],
    ["scale-balanced", "Compare", "/compare"],
    ["wand-magic-sparkles", "AI Solution", "/ai-assistant"],
    ["pen-to-square", "Blog", "/blog"],
  ];
  return (
    <div className="site-header">
      <div className="site-utility">
        <div className="site-utility-inner">
          <div className="location-menu dropdown">
            <button
              type="button"
              className="site-utility-link dropdown-toggle"
              data-bs-toggle="dropdown"
              aria-expanded="false"
            >
              <FaIcon name="location-dot" /> Delivering to{" "}
              <strong>{location}</strong>
            </button>
            <ul className="dropdown-menu">
              <li>
                <button
                  type="button"
                  className="dropdown-item"
                  onClick={() => setLocation("Lahore, Pakistan")}
                >
                  Lahore, Pakistan
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="dropdown-item"
                  onClick={() => setLocation("Karachi, Pakistan")}
                >
                  Karachi, Pakistan
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="dropdown-item"
                  onClick={() => setLocation("Islamabad, Pakistan")}
                >
                  Islamabad, Pakistan
                </button>
              </li>
            </ul>
          </div>
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
          <span className="site-brand-mark">M</span>
          <span>
            <b>MIRWAL</b>
            <small>All finds. You choose.</small>
          </span>
        </button>
        <form
          className="site-search"
          onSubmit={(event) => {
            event.preventDefault();
            navigate("/explore");
          }}
        >
          <div className="site-search-category dropdown">
            <button
              type="button"
              className="site-search-category-button dropdown-toggle"
              data-bs-toggle="dropdown"
              aria-expanded="false"
            >
              {category}
            </button>
            <ul className="dropdown-menu">
              {categories.map((item) => (
                <li key={item}>
                  <button
                    type="button"
                    className="dropdown-item"
                    onClick={() => setCategory(item)}
                  >
                    {item}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <FaIcon name="magnifying-glass" />
          <input
            type="search"
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
          <button type="button" onClick={() => navigate("/compare")}>
            <span>
              <FaIcon name="scale-balanced" />
              <i>0</i>
            </span>
            <small>Compare</small>
          </button>
          <button type="button" onClick={() => navigate("/wishlist")}>
            <span>
              <FaIcon name="heart" />
              <i>0</i>
            </span>
            <small>Wishlist</small>
          </button>
          <button type="button" onClick={() => navigate("/cart")}>
            <span>
              <FaIcon name="cart-plus" />
              <i>{cartCount}</i>
            </span>
            <small>Cart</small>
          </button>
          {isLoggedIn ? (
            <div className="site-user-menu dropdown">
              <button
                className="site-user dropdown-toggle"
                type="button"
                data-bs-toggle="dropdown"
                aria-expanded="false"
              >
                <img
                  src="https://i.pravatar.cc/80?img=11"
                  alt="Muhammad Umar"
                />
                <span>Umar</span>
              </button>
              <ul className="dropdown-menu dropdown-menu-end">
                <li>
                  <button
                    type="button"
                    className="dropdown-item"
                    onClick={() => navigate("/profile")}
                  >
                    <FaIcon name="user" /> My Profile
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    className="dropdown-item"
                    onClick={() => navigate("/orders")}
                  >
                    <FaIcon name="box" /> My Orders
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    className="dropdown-item"
                    onClick={() => navigate("/settings")}
                  >
                    <FaIcon name="gear" /> Settings
                  </button>
                </li>
                <li>
                  <hr className="dropdown-divider" />
                </li>
                <li>
                  <button
                    type="button"
                    className="dropdown-item"
                    onClick={() => navigate("/logout")}
                  >
                    <FaIcon name="right-from-bracket" /> Logout
                  </button>
                </li>
              </ul>
            </div>
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
            <div className="site-category-menu dropdown">
              <button
                className="site-category-button dropdown-toggle"
                type="button"
                data-bs-toggle="dropdown"
                aria-expanded="false"
              >
                <FaIcon name="bars" /> All Categories
              </button>
              <ul className="dropdown-menu">
                {categories.slice(1).map((item) => (
                  <li key={item}>
                    <button
                      type="button"
                      className="dropdown-item"
                      onClick={() => setCategory(item)}
                    >
                      {item}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
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
