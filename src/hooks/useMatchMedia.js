import { useEffect, useState } from "react";

export default function useMatchMedia(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const cb = (e) => setMatches(e.matches);
    mql.addEventListener("change", cb);
    setMatches(mql.matches);
    return () => mql.removeEventListener("change", cb);
  }, [query]);
  return matches;
}
