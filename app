@import "tailwindcss";
@import "tw-animate-css";
@import "../vendor/shadcn-tailwind-4.13.0.css";

@utility scrollbar-thin {
  scrollbar-width: thin;
}

@utility scrollbar-none {
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

@utility scrollbar-gutter-stable {
  scrollbar-gutter: stable;
}

:root {
  --background: #f4f6f8;
  --foreground: #172033;
  --card: #ffffff;
  --card-foreground: #172033;
  --popover: #ffffff;
  --popover-foreground: #172033;
  --primary: #2458d6;
  --primary-foreground: #ffffff;
  --secondary: #eef2f7;
  --secondary-foreground: #25324a;
  --muted: #eef2f7;
  --muted-foreground: #68748a;
  --accent: #e8efff;
  --accent-foreground: #1f4cb8;
  --destructive: #c53a3a;
  --border: #dfe4eb;
  --input: #d6dce5;
  --ring: #2458d6;
  --chart-1: #2458d6;
  --chart-2: #1b9476;
  --chart-3: #dc8c24;
  --chart-4: #6b5cc7;
  --chart-5: #c74d70;
  --radius: 0.75rem;
  --sidebar: #151b26;
  --sidebar-foreground: #dce3ee;
  --sidebar-primary: #ffffff;
  --sidebar-primary-foreground: #151b26;
  --sidebar-accent: #242d3d;
  --sidebar-accent-foreground: #ffffff;
  --sidebar-border: #2c3545;
  --sidebar-ring: #6f96ff;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --font-sans: "Aptos", "Inter", "Segoe UI", Arial, sans-serif;
  --font-mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
}

* {
  border-color: var(--border);
}

html {
  background: var(--background);
}

body {
  min-width: 320px;
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans);
  font-size: 16px;
  text-rendering: optimizeLegibility;
}

button,
a,
input,
select,
textarea {
  font: inherit;
}

.blueprint-grid {
  background-image:
    linear-gradient(rgba(36, 88, 214, 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(36, 88, 214, 0.045) 1px, transparent 1px);
  background-size: 22px 22px;
}

.metric-number {
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.035em;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nexo Obra | Gestão para arquitetura e construção",
  description:
    "Projetos, obras, orçamentos, clientes e equipe em um fluxo simples e conectado.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
import { NexoApp } from "@/components/nexo-app";

export default function Home() {
  return <NexoApp />;
}
