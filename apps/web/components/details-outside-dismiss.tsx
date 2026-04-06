"use client";

import { useEffect } from "react";

const DISMISSIBLE_DETAILS_SELECTOR =
  'details[data-dismiss-on-outside="true"][open]';

export function DetailsOutsideDismiss() {
  useEffect(() => {
    const closeIfClickedOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) {
        return;
      }

      const openMenus = document.querySelectorAll<HTMLDetailsElement>(
        DISMISSIBLE_DETAILS_SELECTOR,
      );

      for (const menu of openMenus) {
        if (!menu.contains(event.target)) {
          menu.removeAttribute("open");
        }
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      const openMenus = document.querySelectorAll<HTMLDetailsElement>(
        DISMISSIBLE_DETAILS_SELECTOR,
      );

      for (const menu of openMenus) {
        menu.removeAttribute("open");
      }
    };

    document.addEventListener("pointerdown", closeIfClickedOutside);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeIfClickedOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return null;
}
