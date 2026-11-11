import { defineConfig } from "vitepress";

export default defineConfig({
  lang: "en",
  title: "Psephex docs",
  titleTemplate: ":title - Psephex docs",
  description: "How Psephex judges deals between AI agents on NEAR testnet, and how to use it from an agent, a NEAR contract or Solidity.",
  cleanUrls: true,
  metaChunk: true,
  lastUpdated: false,
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/logo.svg" }],
    ["link", { rel: "preload", href: "/fonts/Satoshi-Variable.woff2", as: "font", type: "font/woff2", crossorigin: "" }],
    ["meta", { name: "theme-color", content: "#1b2430" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: "Psephex docs" }],
    ["meta", { property: "og:image", content: "https://psephex.xyz/og.png" }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
  ],
  transformPageData(pageData) {
    const title = pageData.title ? `${pageData.title} - Psephex docs` : "Psephex docs";
    const description = pageData.description || "How Psephex judges deals between AI agents on NEAR testnet, and how to use it from an agent, a NEAR contract or Solidity.";
    pageData.frontmatter.head ??= [];
    pageData.frontmatter.head.push(["meta", { property: "og:title", content: title }], ["meta", { property: "og:description", content: description }]);
  },
  markdown: {
    theme: { light: "github-light", dark: "github-dark" },
  },
  themeConfig: {
    logo: { src: "/logo.svg", alt: "" },
    siteTitle: "Psephex",
    notFound: {
      title: "This page does not exist",
      quote: "The link may be from an older version of the docs. Start from the introduction or search.",
      linkText: "Go to the introduction",
    },
    nav: [
      { text: "Docs", link: "/", activeMatch: "^/(guide|build|reference|trust)?" },
      { text: "App", link: "https://psephex.xyz/app" },
      { text: "GitHub", link: "https://github.com/UnityNodes/psephex" },
    ],
    sidebar: [
      {
        text: "Getting started",
        items: [
          { text: "Introduction", link: "/" },
          { text: "How it works", link: "/guide/how-it-works" },
          { text: "Quickstart for agents", link: "/guide/agents" },
        ],
      },
      {
        text: "Build",
        items: [
          { text: "Use the court from NEAR", link: "/build/court" },
          { text: "Ask from a NEAR contract", link: "/build/near-contract" },
          { text: "Ask from Base or Arbitrum", link: "/build/evm" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Contracts and addresses", link: "/reference/contracts" },
          { text: "Read-only API", link: "/reference/api" },
          { text: "FAQ", link: "/reference/faq" },
          { text: "Glossary", link: "/reference/glossary" },
        ],
      },
      {
        text: "Trust",
        items: [
          { text: "Verify a verdict yourself", link: "/trust/verify" },
          { text: "What a verdict proves", link: "/trust/security-model" },
          { text: "Owner timelock", link: "/trust/owner-timelock" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/UnityNodes/psephex", ariaLabel: "Psephex on GitHub" }],
    search: { provider: "local" },
    outline: { level: [2, 3], label: "On this page" },
    docFooter: { prev: "Previous", next: "Next" },
    footer: {
      message: "Testnet only: NEAR testnet, Base Sepolia and Arbitrum Sepolia. MIT license.",
    },
    externalLinkIcon: true,
  },
});
