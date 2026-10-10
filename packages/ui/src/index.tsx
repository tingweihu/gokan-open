import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

export function Button(
  props: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>,
) {
  const { className = "", children, ...rest } = props;
  return (
    <button className={`gokan-button ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
}
