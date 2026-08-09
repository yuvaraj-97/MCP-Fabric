# Configuration file for the Sphinx documentation builder.
import os
import sys
sys.path.insert(0, os.path.abspath('../python'))

project = 'MCP Fabric'
copyright = '2026, MCP Fabric Contributors'
author = 'MCP Fabric Core Team'
release = '0.3.0'

extensions = [
    'sphinx.ext.autodoc',
    'sphinx.ext.napoleon',
    'sphinx.ext.viewcode',
    'sphinx.ext.intersphinx',
    'sphinx.ext.autosummary',
    'myst_parser',
    'sphinx_copybutton',
    'sphinx_autodoc_typehints',
]

myst_enable_extensions = [
    'colon_fence',
    'deflist',
    'fieldlist',
]

templates_path = ['_templates']
exclude_patterns = ['_build', 'Thumbs.db', '.DS_Store']

html_theme = 'furo'
html_theme_options = {
    'sidebar_hide_name': False,
    'navigation_with_keys': True,
    'light_css_variables': {
        'color-brand-primary': '#ee4c2c',
        'color-brand-content': '#ee4c2c',
    },
    'dark_css_variables': {
        'color-brand-primary': '#f05738',
        'color-brand-content': '#f05738',
    },
}

html_static_path = ['_static']
html_title = "MCP Fabric Documentation"
