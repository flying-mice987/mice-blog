import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  srcDir: "../md",
  base: "/mice-blog/",

  title: "mice blog",
  description: "My personal blog!",
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Trackig Board', link: '/tracking-board' }
    ],

    sidebar: [
      {
        text: 'AI4OS训练营',
        items: [
          { text: '00-rCore', link: '/rCore-AI4OS/00-rCore' },
          { text: '01-Hi, RISC-V', link: '/rCore-AI4OS/01-Hi_RISC-V' },
          { text: '02-BatchOS: trapping', link: '/rCore-AI4OS/02-BatchOS_trapping' },
        ]
      }
    ],

    socialLinks: [
      { icon: 'vitepress', link: 'https://github.com/vuejs/vitepress' },
      { icon: 'github', link: 'https://github.com/flying-mice987/mice-blog' }
    ]
  }
})
