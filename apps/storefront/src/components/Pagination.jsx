import "./pagination.css";

const Icon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />;

// Always shows page 1, the last page, and a window around the current page, collapsing any
// gap wider than one page into a single ellipsis — so the control stays a fixed, scannable
// width regardless of whether there are 3 pages or 300.
function buildPageList(page, totalPages, siblingCount = 1) {
  const totalNumbers = siblingCount * 2 + 5;
  if (totalPages <= totalNumbers) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const left = Math.max(page - siblingCount, 2);
  const right = Math.min(page + siblingCount, totalPages - 1);

  const pages = [1];
  if (left > 2) pages.push("ellipsis-left");
  for (let value = left; value <= right; value += 1) pages.push(value);
  if (right < totalPages - 1) pages.push("ellipsis-right");
  pages.push(totalPages);
  return pages;
}

// One pagination control shared by every product/seller/category listing page, so a shopper
// sees the same page-number widget with the same behaviour everywhere instead of each page's
// own Previous/Next-only variant (several of which had no numbered pages at all).
export default function Pagination({ page, totalPages, onChange, className = "" }) {
  if (!totalPages || totalPages <= 1) return null;

  const goTo = (value) => {
    if (value === page || value < 1 || value > totalPages) return;
    onChange(value);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <nav className={`pagination${className ? ` ${className}` : ""}`} aria-label="Pagination">
      <button
        type="button"
        className="pagination-arrow"
        disabled={page === 1}
        onClick={() => goTo(page - 1)}
        aria-label="Previous page"
      >
        <Icon name="chevron-left" />
      </button>
      <div className="pagination-pages">
        {buildPageList(page, totalPages).map((value, index) =>
          typeof value === "number" ? (
            <button
              type="button"
              key={value}
              className={value === page ? "pagination-page is-active" : "pagination-page"}
              aria-current={value === page ? "page" : undefined}
              aria-label={`Page ${value}`}
              onClick={() => goTo(value)}
            >
              {value}
            </button>
          ) : (
            <span className="pagination-ellipsis" key={`${value}-${index}`} aria-hidden="true">
              &hellip;
            </span>
          ),
        )}
      </div>
      <button
        type="button"
        className="pagination-arrow"
        disabled={page === totalPages}
        onClick={() => goTo(page + 1)}
        aria-label="Next page"
      >
        <Icon name="chevron-right" />
      </button>
    </nav>
  );
}
