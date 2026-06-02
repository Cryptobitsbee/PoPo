import { useState, type ComponentType } from "react";
import { NavLink } from "react-router-dom";
import type { IconProps } from "@phosphor-icons/react";
import Tooltip from "../shared/Tooltip";

/**
 * NavItem — a single sidebar navigation zone.
 *
 * Per brief §3 Sidebar:
 *   Zone per icon: 44×44px · icon 18px Phosphor regular
 *   Active:   bg --bg-elevated · radius --radius-button · icon --text-primary
 *   Inactive: icon --text-ghost
 *   Hover:    icon --text-secondary (120ms transition)
 *   Tooltip floats right on hover (label is passed as prop)
 *
 * Uses react-router's NavLink for the active state. The NavLink's
 * children-as-function pattern exposes `isActive` so we can drive the
 * background + icon color from it directly.
 */

export interface NavItemProps {
  to: string;
  label: string;
  icon: ComponentType<IconProps>;
}

export default function NavItem({ to, label, icon: Icon }: NavItemProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <Tooltip label={label} side="right">
      <NavLink
        to={to}
        end
        aria-label={label}
        style={{ textDecoration: "none" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {({ isActive }) => (
          <div
            style={{
              width: 44,
              height: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "var(--radius-button)",
              background: isActive ? "var(--bg-elevated)" : "transparent",
              transition: "background-color 120ms ease",
              cursor: "pointer",
            }}
          >
            <Icon
              size={18}
              weight="regular"
              // Session 55 retune: was ghost → secondary → primary
              // (default → hover → active). Default ghost was 1.7:1
              // contrast — invisible. Now: default secondary (~4.5:1,
              // visible at rest), hover/active primary (full bright).
              // The active state ALSO gets the bg lift, so hover and
              // active are visually distinct: same icon color but
              // active has the elevated panel underneath.
              color={
                isActive || hovered
                  ? "var(--text-primary)"
                  : "var(--text-secondary)"
              }
              style={{ transition: "color 120ms ease" }}
            />
          </div>
        )}
      </NavLink>
    </Tooltip>
  );
}
