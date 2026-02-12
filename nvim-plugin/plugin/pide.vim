" pide.vim - IDE Integration for pi
" Maintainer: Pierre Borckmans
" License: MIT

if exists('g:loaded_pide')
  finish
endif
let g:loaded_pide = 1

" Plugin is lazy-loaded via lua require("pide").setup()
" This file exists for compatibility with traditional vim plugin managers
