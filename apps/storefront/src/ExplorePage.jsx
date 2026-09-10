import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useApiQuery, describeApiError } from "@mirwal/shared/useApiQuery";
import api from "./api";
import { ErrorState, LoadingState } from "@mirwal/shared/PageStates";
import Pagination from "./components/Pagination";
import PromoBanner from "./components/PromoBanner";
import { navigateTo } from "@mirwal/shared/navigation";
import WishlistHeart from "./components/WishlistHeart";
import "./explore.css";

const Icon = ({ name }) => (
  <i className={`fa-solid fa-${name}`} aria-hidden="true" />
);
const brands = [
  "Apple",
  "Samsung",
  "Dell",
  "Sony",
  "Philips",
  "JBL",
  "Canon",
  "Lenovo",
  "Nike",
  "Dyson",
  "Adidas",
  "Logitech",
];
const sorts = ["Recommended", "Price: Low to High", "Price: High to Low", "Top Rated", "Newest"];

// Storefront sort labels -> API sort keys.
const SORT_KEYS = {
  "Recommended": "recommended",
  "Price: Low to High": "price-low",
  "Price: High to Low": "price-high",
  "Top Rated": "rating",
  "Newest": "newest",
};
const quickPicks = [
  ["Phones", "mobile-screen-button", "phone", 0],
  ["Laptops", "laptop", "laptop", 2],
  ["Gaming", "gamepad", "gaming", 19],
  ["Fashion", "shirt", "Fashion", 12],
  ["Home", "house", "Home & Living", 4],
  ["Beauty", "bottle-droplet", "Beauty & Health", 14],
  ["Travel", "suitcase-rolling", "travel", 15],
  ["Gifts", "gift", "gifts", 24],
];
function arrivalPickIcon(name) {
  const value = name.toLowerCase()
  if (value.includes('tech') || value.includes('mobile')) return 'laptop'
  if (value.includes('fashion')) return 'shirt'
  if (value.includes('home') || value.includes('kitchen')) return 'house'
  if (value.includes('fitness') || value.includes('sport')) return 'dumbbell'
  if (value.includes('beauty') || value.includes('care')) return 'sparkles'
  if (value.includes('baby')) return 'baby'
  if (value.includes('car') || value.includes('motorcycle')) return 'car'
  return 'layer-group'
}
const saleTypeIcons = { promotion: 'percent', campaign: 'bullhorn', flash_sale: 'bolt' };

function useQueryState(location) {
  const params = new URLSearchParams(location.search);
  const values = (key) => (params.get(key) || "").split(",").filter(Boolean);
  return {
    params,
    search: params.get("q") || params.get("search") || "",
    category: values("category"),
    brand: values("brand"),
    type: values("type"),
    rating: values("rating"),
    minPrice: params.get("minPrice") || "",
    maxPrice: params.get("maxPrice") || "",
    discount: params.get("discount") || "",
    availability: values("availability"),
    sort: params.get("sort") || "Recommended",
    page: Math.max(1, Number(params.get("page") || 1)),
    saleType: params.get("saleType") || "",
  };
}
const intentCategories = [{ terms: ['phone', 'smartphone'], label: 'Phones' }, { terms: ['laptop', 'notebook'], label: 'Laptops' }, { terms: ['earbud', 'headphone'], label: 'Wireless Audio' }, { terms: ['shoe', 'sneaker'], label: 'Shoes' }, { terms: ['camera'], label: 'Cameras' }]

function getSearchIntent(query) {
  const normalized = query.toLowerCase()
  const category = intentCategories.find((item) => item.terms.some((term) => normalized.includes(term)))
  const budgetMatch = normalized.match(/(?:under|below|less than)\s*(?:rs\.?\s*)?([\d,]+)\s*(k)?/)
  const amount = budgetMatch ? Number(budgetMatch[1].replace(/,/g, '')) * (budgetMatch[2] ? 1000 : 1) : 0
  const brand = brands.find((item) => normalized.includes(item.toLowerCase()))
  const best = normalized.includes('best') || normalized.includes('top')
  const useCase = ['gaming', 'camera', 'student', 'work', 'travel', 'fitness'].find((term) => normalized.includes(term))
  return { category: category?.label || '', brand: brand || '', maxPrice: amount, best, useCase }
}

function ProductCard({ product, sponsored = false }) {

  // discountPercent is derived server-side from price vs compare_at_price.
  const discount = product.discountPercent ?? 0;
  const image = product.images?.[0];
  // "Popular" is only shown once a product has actually earned it — 100+ real ratings — rather
  // than as a default fallback label every non-discounted, non-new product would otherwise get.
  const saleTag = product.saleTags?.[0]
  const badge = sponsored ? "Sponsored" : saleTag?.name || (discount > 0 ? `−${discount}%` : product.condition === "new" ? "New" : product.rating.count >= 100 ? "Popular" : null);
  const badgeTone = sponsored ? "sponsored" : saleTag?.kind === 'flash_sale' ? "discount" : saleTag ? "new" : discount > 0 ? "discount" : product.condition === "new" ? "new" : "popular";
  const openProduct = () => navigateTo(`/product/${product.slug}`)
  const handleCardClick = (event) => {
    if (event.target.closest('button, a, input, label, select, textarea')) return
    openProduct()
  }
  const handleCardKeyDown = (event) => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openProduct()
    }
  }
  return (
    <article className="explore-product-card" onClick={handleCardClick} onKeyDown={handleCardKeyDown} role="link" tabIndex="0" aria-label={`View ${product.name}`}>
      <div className="explore-product-media">
        {badge && <span className={`explore-product-badge explore-product-badge--${badgeTone}`}>{badge}</span>}
        <img src={image?.url} alt={image?.alt ?? product.name} loading="lazy" />
        <WishlistHeart product={product} className="explore-wishlist" savedClassName="is-saved" />
      </div>
      <div className="explore-product-body">
        <span className="explore-product-type">{product.subtitle}</span>
        <h3>
          <button
            type="button"
            onClick={() => navigateTo(`/product/${product.slug}`)}
          >
            {product.name}
          </button>
        </h3>
        <p className="explore-product-rating">
          <Icon name="star" /> {product.rating.count > 0 ? `${product.rating.average.toFixed(1)} (${product.rating.count})` : "No reviews yet"}
        </p>
        <div className="explore-price">
          <strong>{product.price.display}</strong>
          {product.compareAtPrice && <del>{product.compareAtPrice.display}</del>}
        </div>
        <p className="explore-trust">
          <Icon name="store" /> {product.seller?.name ?? "Marketplace seller"}
        </p>
      </div>
    </article>
  );
}

const filterIcons = {
  Category: "table-cells-large",
  Brand: "tag",
  Price: "dollar-sign",
  Rating: "star",
  Availability: "box-open",
  Discount: "percent",
  "More filters": "ellipsis",
  Sort: "sort",
  Explore: "compass",
  "Shop by need": "bullseye",
  "My shopping": "bag-shopping",
};

function FilterBlock({ title, children, open = false }) {
  return (
    <details className="explore-filter-block" data-filter={title} open={open}>
      <summary>
        <Icon name={filterIcons[title] || "sliders"} />
        <span>{title}</span>
        <Icon name="chevron-down" />
      </summary>
      <div>{children}</div>
    </details>
  );
}

function CheckList({ values, selected, onToggle, labels = values }) {
  return (
    <div className="explore-check-list">
      {values.map((value, index) => (
        <label key={value}>
          <input
            type="checkbox"
            checked={selected.includes(value)}
            onChange={() => onToggle(value)}
          />{" "}
          <span>{labels[index] || value}</span>
        </label>
      ))}
    </div>
  );
}

export default function ExplorePage({ dealsOnly = false, newArrivals = false, allProducts = false }) {
  const location = useLocation();
  const state = useQueryState(location);
    const effectiveSort = newArrivals && !location.search.includes('sort=') ? 'Newest' : state.sort
    const searchIntent = getSearchIntent(state.search)
    const filterCategory = state.type.some((type) => type.includes('Smartphone')) ? 'Phones' : state.type.some((type) => type.includes('Laptop')) ? 'Laptops' : state.category[0] || ''
    const displayCategory = searchIntent.category || filterCategory
    const displayBrand = searchIntent.brand || state.brand[0] || ''
    const displayMaxPrice = state.maxPrice || (searchIntent.maxPrice ? String(searchIntent.maxPrice) : '')
    const effectiveMaxPrice = displayMaxPrice
    const displayMinPrice = state.minPrice || ''
    const displaySubject = displayCategory || (state.search ? state.search.split(/\s+/).filter((term) => term.length > 2).map((term) => term[0].toUpperCase() + term.slice(1)).join(' ') : 'Products')
    const heading = (state.search || displayCategory || displayBrand || displayMaxPrice) ? `${searchIntent.best ? 'Best ' : ''}${searchIntent.useCase && displayCategory ? `${searchIntent.useCase[0].toUpperCase()}${searchIntent.useCase.slice(1)} ` : ''}${displayBrand ? `${displayBrand} ` : ''}${displaySubject}${displayMinPrice ? ` From Rs. ${Number(displayMinPrice).toLocaleString()}` : ''}${displayMaxPrice ? ` Under Rs. ${displayMaxPrice === 'premium' ? '100,000+' : Number(displayMaxPrice).toLocaleString()}` : ''}` : dealsOnly ? 'Deals' : newArrivals ? 'New Arrivals' : allProducts ? 'All Products' : 'Explore Products'
    const intentDescription = displayCategory === 'Phones' ? `Explore ${searchIntent.best ? 'the best ' : ''}smartphones${displayMaxPrice ? ` under Rs. ${Number(displayMaxPrice).toLocaleString()}` : ''} in Pakistan. Compare prices, ratings, features and sellers to find the right phone for your needs.` : displayCategory === 'Laptops' ? `Compare laptops${displayMaxPrice ? ` under Rs. ${Number(displayMaxPrice).toLocaleString()}` : ''} by price, ratings and practical features to find the right fit for work, study or play.` : displayBrand || displayCategory || displayMaxPrice ? `Explore ${displayBrand ? `${displayBrand} ` : ''}${displaySubject.toLowerCase()}${displayMaxPrice ? ` under ${displayMaxPrice === 'premium' ? 'Rs. 100,000+' : `Rs. ${Number(displayMaxPrice).toLocaleString()}`}` : ''}. Compare prices, ratings and sellers to find the right option for your needs.` : dealsOnly ? 'Discover current deals, compare prices, and find the best offers from trusted Mirwal sellers.' : 'Discover products that fit your needs, compare your options, and find the right choice with Mirwal.'
    const popularSearches = searchIntent.category === 'Phones' ? [['Under 25K', 'maxPrice', '25000'], ['Under 50K', 'maxPrice', '50000'], ['Under 75K', 'maxPrice', '75000'], ['Best Camera', 'search', 'camera'], ['Best Gaming', 'search', 'gaming']] : searchIntent.category === 'Laptops' ? [['Under 100K', 'maxPrice', '100000'], ['Under 150K', 'maxPrice', '150000'], ['Best Value', 'search', 'laptop'], ['Student Laptops', 'search', 'student laptop']] : [['Phones', 'search', 'phone'], ['Laptops', 'search', 'laptop'], ['Best Deals', 'path', '/deals'], ['Popular Brands', 'path', '/brands']]
  // Facet values come from the live catalogue, so every option shown returns results.
  const { data: facets, error: facetsError } = useApiQuery((signal) => api.products.facets(signal), []);
  const [mobileFilters, setMobileFilters] = useState(false);
  const [aiQuery, setAiQuery] = useState('');
  useEffect(() => {
    document.title = state.search ? `${heading} | Mirwal` : `${dealsOnly ? 'Deals' : newArrivals ? 'New Arrivals' : allProducts ? 'All Products' : 'Explore Products'} | Mirwal`;
    let description = document.querySelector('meta[name="description"]');
    if (!description) {
      description = document.createElement("meta");
      description.name = "description";
      document.head.appendChild(description);
    }
    description.content = intentDescription;
  }, [allProducts, dealsOnly, newArrivals, heading, intentDescription, state.search]);
  const updateQuery = (updates) => {
    const next = new URLSearchParams(location.search);
    Object.entries(updates).forEach(([key, value]) => {
      const queryKey = key === "search" && location.pathname === "/search" ? "q" : key;
      value
        ? next.set(queryKey, Array.isArray(value) ? value.join(",") : value)
        : next.delete(queryKey);
    },
    );
    const basePath = dealsOnly ? "/deals" : newArrivals ? "/new-arrivals" : allProducts ? "/products" : location.pathname === "/search" ? "/search" : "/explore";
    navigateTo(`${basePath}${next.toString() ? `?${next}` : ""}`);
  };
  const toggle = (key, value, selected) =>
    updateQuery({
      [key]: selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value],
      page: "",
    });
  const clearFilters = () => navigateTo(dealsOnly ? "/deals" : newArrivals ? "/new-arrivals" : allProducts ? "/products" : location.pathname === "/search" ? "/search" : "/explore");
  const ignoredSearchTerms = ['for', 'the', 'under', 'with', 'best', 'top', 'less', 'than', 'below', 'phones', 'smartphones', 'laptops', 'notebook', 'earbuds', 'headphones', 'shoes', 'sneakers', 'camera', 'cameras', ...(searchIntent.brand ? [searchIntent.brand.toLowerCase()] : [])];
  const searchTerms = state.search.toLowerCase().split(/\s+/).filter((term) => term.length > 2 && !ignoredSearchTerms.includes(term.replace(/[,.]/g, '')) && !/^\d[\d,]*(k)?$/i.test(term));
  // Filtering, sorting and pagination now happen in the database. The facet values in
  // the URL are user-facing names (e.g. ?category=Electronics) for backwards
  // compatibility with existing links, and are mapped to slugs before the request.
  const toSlugs = (values, list) => values
    .map((value) => {
      const match = list.find((item) => item.slug === value || item.name.toLowerCase() === value.toLowerCase());
      return match?.slug;
    })
    .filter(Boolean);

  const categoryParam = facets ? toSlugs(state.category, facets.categories) : [];
  const brandParam = facets ? toSlugs(state.brand, facets.brands) : [];
  const minRating = state.rating.length ? Math.min(...state.rating.map(Number)) : undefined;
  const onSale = state.availability.includes("On sale");

  const listQuery = {
    q: searchTerms.join(" ") || undefined,
    category: categoryParam.length ? categoryParam : undefined,
    brand: brandParam.length ? brandParam : undefined,
    type: state.type.length ? state.type : undefined,
    saleType: dealsOnly ? state.saleType || undefined : undefined,
    minPrice: state.minPrice || undefined,
    maxPrice: effectiveMaxPrice && effectiveMaxPrice !== "premium" ? effectiveMaxPrice : undefined,
    rating: minRating,
    minDiscount: state.discount ? Number(state.discount) : (onSale || dealsOnly ? 1 : undefined),
    sort: SORT_KEYS[effectiveSort] ?? "recommended",
    page: state.page,
    pageSize: 24,
  };

  const { data: listData, error: listError, isLoading, refetch } = useApiQuery(
    (signal) => api.products.list(listQuery, signal),
    [JSON.stringify(listQuery)],
    { enabled: Boolean(facets) },
  );

  const visible = listData?.items ?? [];
  const pagination = listData?.pagination;
  const totalResults = pagination?.total ?? 0;
  const page = pagination?.page ?? 1;
  const pages = pagination?.totalPages ?? 1;
  const sponsored = [];
  // The banner always features whichever real product on this results page has the
  // biggest actual discount — nothing here is a fixed or invented promotion.
  const topDeal = visible.length
    ? [...visible].filter((product) => product.discountPercent > 0).sort((a, b) => b.discountPercent - a.discountPercent)[0]
    : null;
  const activeFilters = [
    ...state.category.map((value) => [value, "category", value]),
    ...state.brand.map((value) => [value, "brand", value]),
    ...state.type.map((value) => [value, "type", value]),
    ...state.rating.map((value) => [`${value} stars & up`, "rating", value]),
    ...(state.minPrice
      ? [
          [
            `From Rs. ${Number(state.minPrice).toLocaleString()}`,
            "minPrice",
            state.minPrice,
          ],
        ]
      : []),
    ...(state.maxPrice
      ? [
          [
            `Up to Rs. ${Number(state.maxPrice).toLocaleString()}`,
            "maxPrice",
            state.maxPrice,
          ],
        ]
      : []),
    ...(state.discount
      ? [[`${state.discount}% off or more`, "discount", state.discount]]
      : []),
    ...state.availability.map((value) => [value, "availability", value]),
    ...(state.saleType ? [[state.saleType.replace('_', ' '), "saleType", state.saleType]] : []),
  ];
  const renderSidebar = () => (
    <>
      <aside
        className={mobileFilters ? "explore-sidebar is-open" : "explore-sidebar"}
      >
      <div className="explore-sidebar-head">
        <strong>
          Filters{" "}
          <small>
            {activeFilters.length ? `(${activeFilters.length})` : ""}
          </small>
        </strong>
        <button
          type="button"
          onClick={() => setMobileFilters(false)}
          aria-label="Close filters"
        >
          <Icon name="xmark" />
        </button>
      </div>
      <FilterBlock title="Category">
        <CheckList
          values={(facets?.categories ?? []).map((item) => item.name)}
          selected={state.category}
          onToggle={(value) => toggle("category", value, state.category)}
        />
      </FilterBlock>
      <FilterBlock title="Brand">
        <CheckList
          values={(facets?.brands ?? []).slice(0, 12).map((item) => item.name)}
          selected={state.brand}
          onToggle={(value) => toggle("brand", value, state.brand)}
        />
      </FilterBlock>
      <FilterBlock title="Price">
        <div className="explore-range">
          <label>
            Min price
            <input
              type="number"
              min="0"
              value={state.minPrice}
              onChange={(event) =>
                updateQuery({ minPrice: event.target.value, page: "" })
              }
              placeholder="Rs. 0"
            />
          </label>
          <label>
            Max price
            <input
              type="number"
              min="0"
              value={state.maxPrice}
              onChange={(event) =>
                updateQuery({ maxPrice: event.target.value, page: "" })
              }
              placeholder="Any"
            />
          </label>
        </div>
      </FilterBlock>
      <FilterBlock title="Rating">
        <CheckList
          values={["4", "3", "2"]}
          selected={state.rating}
          labels={["4★ & up", "3★ & up", "2★ & up"]}
          onToggle={(value) => toggle("rating", value, state.rating)}
        />
      </FilterBlock>
      <FilterBlock title="Availability">
        <CheckList
          values={["On sale"]}
          selected={state.availability}
          labels={["Available for delivery / sale"]}
          onToggle={(value) =>
            toggle("availability", value, state.availability)
          }
        />
      </FilterBlock>
      <FilterBlock title="Discount">
        <CheckList
          values={["10", "20", "30"]}
          selected={state.discount ? [state.discount] : []}
          labels={["10%+ off", "20%+ off", "30%+ off"]}
          onToggle={(value) =>
            updateQuery({
              discount: state.discount === value ? "" : value,
              page: "",
            })
          }
        />
      </FilterBlock>
      <FilterBlock title="More filters">
        <CheckList
          values={(facets?.types ?? []).slice(0, 12).map((item) => item.value)}
          selected={state.type}
          onToggle={(value) => toggle("type", value, state.type)}
        />
      </FilterBlock>
      <FilterBlock title="Sort">
        <label className="explore-sort-select">
          <span>Sort products by</span>
          <select value={effectiveSort} onChange={(event) => updateQuery({ sort: event.target.value, page: '' })} aria-label="Sort products">
            {sorts.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
      </FilterBlock>
      {activeFilters.length > 0 && (
        <div className="explore-sidebar-active">
          {activeFilters.map(([label, key, value]) => (
            <button
              type="button"
              key={`${key}-${value}`}
              onClick={() =>
                key === "minPrice" || key === "maxPrice" || key === "discount" || key === "saleType"
                  ? updateQuery({ [key]: "" })
                  : toggle(
                      key,
                      value,
                      key === "category"
                        ? state.category
                        : key === "brand"
                          ? state.brand
                          : key === "type"
                            ? state.type
                            : key === "rating"
                              ? state.rating
                              : state.availability,
                    )
              }
            >
              {label} <Icon name="xmark" />
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="explore-clear-button"
        onClick={clearFilters}
      >
        Clear all
      </button>
      <FilterBlock title="Explore">
        <div className="explore-sidebar-links">
        {[
          ["All Products", "/products"],
          ["Categories", "/categories"],
          ["Brands", "/brands"],
          ["Deals", "/deals"],
        ].map(([label, path]) => (
          <button type="button" key={label} onClick={() => navigateTo(path)}>
            {label}
          </button>
        ))}
        </div>
      </FilterBlock>
      <FilterBlock title="Shop by need">
        <div className="explore-sidebar-links">
          {[
            ["Study", "study"],
            ["Work", "work"],
            ["Gaming", "gaming"],
            ["Travel", "travel"],
            ["Home", "home"],
            ["Fitness", "fitness"],
            ["Gifts", "gifts"],
            ["Fashion", "fashion"],
          ].map(([label, value]) => (
            <button
              type="button"
              key={value}
              onClick={() => updateQuery({ search: value })}
            >
              {label}
            </button>
          ))}
        </div>
      </FilterBlock>
      <FilterBlock title="My shopping">
        <div className="explore-sidebar-links">
          <button type="button" onClick={() => navigateTo("/wishlist")}>
            Wishlist
          </button>
          <button type="button" onClick={() => navigateTo("/recently-viewed")}>
            Recently viewed
          </button>
          <button type="button" onClick={() => navigateTo("/compare")}>
            Saved comparisons
          </button>
        </div>
      </FilterBlock>
      </aside>
      {mobileFilters && (
        <button
          type="button"
          className="explore-sidebar-scrim"
          onClick={() => setMobileFilters(false)}
          aria-label="Close filters"
        />
      )}
    </>
  );
  return (
    <main className="explore-page">
      <div className="explore-container">
        <nav className="explore-breadcrumb" aria-label="Breadcrumb">
          <button type="button" onClick={() => navigateTo("/")}>
            Home
          </button>
          <span>/</span>
          <span aria-current="page">{state.search ? 'Search results' : 'Explore'}</span>
        </nav>
        <header className="explore-heading">
          <span className="explore-kicker">
            <Icon name="compass" /> MIRWAL DISCOVERY
          </span>
          <h1>{heading}</h1>
          <p>{intentDescription}</p>
        </header>
        {topDeal && (
          <PromoBanner
            eyebrow="Spotted in these results"
            title={`${topDeal.discountPercent}% off ${topDeal.name}`}
            subtitle={`${topDeal.price.display}${topDeal.compareAtPrice ? ` — was ${topDeal.compareAtPrice.display}` : ''}`}
            ctaLabel="View product"
            onCta={() => navigateTo(`/product/${topDeal.slug}`)}
            image={topDeal.images[0]?.url}
            imageAlt={topDeal.images[0]?.alt ?? topDeal.name}
            badge={`−${topDeal.discountPercent}%`}
          />
        )}
        {state.search && <div className="explore-search-context"><span>Search context:</span>{searchIntent.category && <b><Icon name="mobile-screen-button" /> Category: {searchIntent.category}</b>}{searchIntent.brand && <b><Icon name="tag" /> Brand: {searchIntent.brand}</b>}{searchIntent.maxPrice > 0 && <b><Icon name="wallet" /> Under Rs. {searchIntent.maxPrice.toLocaleString()}</b>}{searchIntent.best && <b><Icon name="star" /> Best value</b>}</div>}
        <section className="explore-quick">
          <div className="explore-quick-heading">
            <h2>{state.search ? 'Popular searches' : dealsOnly ? 'Types of sales' : newArrivals ? 'Fresh picks' : 'Quick picks'}</h2>
          </div>
          <div className="explore-quick-list">
            {(state.search ? popularSearches : dealsOnly ? (facets?.saleTypes ?? []).map((item) => [item.name, saleTypeIcons[item.kind] || 'tag', item.kind]) : newArrivals ? (facets?.categories ?? []).map((item) => [item.name, arrivalPickIcon(item.name), item.slug]) : quickPicks).map(([label, icon, value]) => (
              <button
                type="button"
                key={label}
                onClick={() => dealsOnly && !state.search ? updateQuery({ saleType: value, page: '' }) : newArrivals && !state.search ? updateQuery({ category: value, page: '' }) : icon === 'path' ? navigateTo(value) : icon === 'maxPrice' || icon === 'search' ? updateQuery({ [icon === 'maxPrice' ? 'maxPrice' : 'search']: value }) :
                  value.startsWith("phone") || value === "laptop"
                    ? updateQuery({ search: value })
                    : value === "travel" || value === "gifts"
                      ? updateQuery({ search: value })
                      : navigateTo(
                          `/categories/${value.toLowerCase().replace(/ & /g, "-").replace(/ /g, "-")}`,
                        )
                }
              >
                <span><Icon name={icon} /></span>
                <b>{label}</b>
              </button>
            ))}
            {!state.search && <button type="button" className="explore-quick-view-all" onClick={() => navigateTo('/categories')}>View all <Icon name="chevron-right" /></button>}
          </div>
        </section>
        <div className="explore-main-layout">
          {renderSidebar()}
          <section className="explore-results">
            <div className="explore-results-head">
              <div>
                <span className="explore-kicker">
                  {dealsOnly ? 'CURRENT DEALS' : newArrivals ? 'JUST LANDED' : 'CURATED PRODUCT DISCOVERY'}
                </span>
                <h2>{dealsOnly ? 'Deals for you' : newArrivals ? 'New arrivals for you' : 'Top picks for you'}</h2>
              </div>
              <button type="button" className="explore-mobile-refine" onClick={() => setMobileFilters(true)}><Icon name="sliders" /> Filters</button>
              <div className="explore-results-tools">
                <strong><Icon name="bag-shopping" /> {totalResults} products</strong>
                <label className="explore-top-sort">
                  <span>Sort by</span>
                  <select value={effectiveSort} onChange={(event) => updateQuery({ sort: event.target.value, page: '' })} aria-label="Sort products">
                    {sorts.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
              </div>
            </div>
            {activeFilters.length > 0 && (
              <div className="explore-active-filters">
                <span>Filters:</span>
                {activeFilters.map(([label, key, value]) => (
                  <button
                    type="button"
                    key={`${key}-${value}`}
                    onClick={() =>
                      key === "minPrice" ||
                      key === "maxPrice" ||
                      key === "discount" ||
                      key === "saleType"
                        ? updateQuery({ [key]: "" })
                        : toggle(
                            key,
                            value,
                            key === "category"
                              ? state.category
                              : key === "brand"
                                ? state.brand
                                : key === "type"
                                  ? state.type
                                  : key === "rating"
                                    ? state.rating
                                    : state.availability,
                          )
                    }
                  >
                    {label} <Icon name="xmark" />
                  </button>
                ))}
                <button type="button" onClick={clearFilters}>
                  Clear all
                </button>
              </div>
            )}
            {(listError || facetsError) ? (
              <ErrorState
                title="We could not load products"
                description={describeApiError(listError || facetsError)}
                onRetry={refetch}
              />
            ) : isLoading || !facets ? (
              <LoadingState label="Loading products" />
            ) : visible.length ? (
              <div className="explore-product-grid">
                {visible.slice(0, 4).map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                  />
                ))}
                <article className="explore-inline-promo explore-inline-promo--ai">
                  <Icon name="robot" />
                  <div><span>Mirwal AI</span><strong>Find your best match</strong><small>Get a shortlist made for you.</small></div>
                  <form onSubmit={(event) => { event.preventDefault(); if (aiQuery.trim()) navigateTo(`/ai-shopping?query=${encodeURIComponent(aiQuery.trim())}`) }}>
                    <Icon name="magnifying-glass" />
                    <input value={aiQuery} onChange={(event) => setAiQuery(event.target.value)} placeholder="Search for a product..." aria-label="Search for a product" />
                    <button type="submit" aria-label="Search"><Icon name="arrow-right" /></button>
                  </form>
                  <button type="button" onClick={() => navigateTo('/ai-assistant')}>Ask Mirwal AI <Icon name="arrow-right" /></button>
                </article>
                {sponsored.length > 0 && (
                  <div className="explore-sponsored-label">
                    <span>Sponsored Products</span>
                  </div>
                )}
                {sponsored.map((product) => (
                  <ProductCard
                    key={`sponsored-${product.id}`}
                    product={product}
                    sponsored
                  />
                ))}
                {visible.slice(4, 8).map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                  />
                ))}
                <article className="explore-inline-promo explore-inline-promo--compare">
                  <Icon name="scale-balanced" />
                  <div><span>Compare smarter</span><strong>See the difference</strong><small>Review your options side by side.</small></div>
                  <button type="button" onClick={() => navigateTo('/compare')}>Open comparison <Icon name="arrow-right" /></button>
                </article>
                {visible.slice(8).map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                  />
                ))}
              </div>
            ) : (
              <div className="explore-empty">
                <Icon name="box-open" />
                <h2>No products found</h2>
                <p>Try removing a filter or broadening your search.</p>
                <button type="button" onClick={clearFilters}>
                  Clear filters
                </button>
              </div>
            )}
            <Pagination page={page} totalPages={pages} onChange={(value) => updateQuery({ page: String(value) })} />
          </section>
        </div>
        <section className="explore-decision-grid">
          <article><span className="explore-kicker"><Icon name="lightbulb" /> SHOPPING GUIDE</span><h2>What to look for{searchIntent.category ? ` in ${searchIntent.category}` : ''}{searchIntent.maxPrice ? ` Under Rs. ${searchIntent.maxPrice.toLocaleString()}` : ''}</h2><p>{searchIntent.category === 'Phones' ? 'Prioritize the camera, battery and storage that match how you use your phone. Ratings and seller details help you compare with confidence.' : searchIntent.category === 'Laptops' ? 'Think about performance first: choose the processor, memory and storage that fit your daily work, study or gaming needs.' : 'Compare the features that matter to you, then use ratings, prices and seller information to narrow the shortlist.'}</p></article>
           <article className="explore-compare-prompt"><div><span className="explore-kicker"><Icon name="scale-balanced" /> COMPARE</span><h2>See the difference side by side</h2><p>Shortlist your favorites and compare the details that matter before you decide.</p><button type="button" onClick={() => navigateTo('/compare')}>Open comparison <Icon name="arrow-right" /></button></div></article>
        </section>
        {state.search && <section className="explore-related"><h2>Related searches</h2><div>{(searchIntent.category === 'Phones' ? ['Phones Under 25K', 'Phones Under 75K', 'Best Camera Phones', 'Best Gaming Phones', 'Best Battery Phones'] : searchIntent.category === 'Laptops' ? ['Laptops Under 100K', 'Best Student Laptops', 'Gaming Laptops', 'Best Value Laptops'] : ['Popular products', 'Best value products', 'Compare products']).map((label) => <button type="button" key={label} onClick={() => updateQuery({ search: label.toLowerCase() })}>{label}</button>)}</div></section>}
        <section className="explore-help">
          <div><span className="explore-kicker"><Icon name="robot" /> MIRWAL AI</span><h2>Still deciding? Let's narrow it down.</h2><p>Tell Mirwal what matters to you and get a shortlist worth comparing.</p></div>
          <button type="button" onClick={() => navigateTo("/ai-assistant")}>
            <Icon name="robot" /> Ask Mirwal AI 
          </button>
        </section>
        <section className="explore-links">
          <h2>Keep exploring</h2>
          {[
            ["Browse product categories", "/categories"],
            ["Shop popular brands", "/brands"],
            ["See current deals", "/deals"],
            ["Compare products side by side", "/compare"],
          ].map(([label, path]) => (
            <button type="button" key={path} onClick={() => navigateTo(path)}>
              {label}
            </button>
          ))}
        </section>
      </div>
    </main>
  );
}
