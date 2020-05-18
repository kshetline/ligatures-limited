# Ligatures Limited

## Code ligatures _only where you want them_, not where you don’t

I enjoy using ligature fonts for coding so that symbols like arrows (<img src="https://shetline.com/readme/ligatures-limited/v1.0.0/fat_arrow_nolig.png" width="16" height="14" align="absmiddle" alt="fat arrow no ligature">) look like arrows (<img src="https://shetline.com/readme/ligatures-limited/v1.0.0/fat_arrow.png" width="17" height="14" align="absmiddle" alt="fat arrow no ligature">) and does-not-equal signs (<img src="https://shetline.com/readme/ligatures-limited/v1.0.0/not_equal_nolig.png" width="17" height="14" align="absmiddle" alt="fat arrow no ligature">) look like the real thing from math class (<img src="https://shetline.com/readme/ligatures-limited/v1.0.0/not_equal.png" width="17" height="14" align="absmiddle" alt="fat arrow no ligature">). The problem is that, even with some of the contextual smarts build into ligature fonts like Fira Code, ligatures have a knack of popping up where you don’t want them.

<img src="https://shetline.com/readme/ligatures-limited/v1.0.0/without_suppressed_ligatures.jpg" width="407" height="67" alt="Without ligature suppression">
<br>
<img src="https://shetline.com/readme/ligatures-limited/v1.0.0/with_suppressed_ligatures.jpg" width="407" height="67" alt="With ligature suppression">

*Ligatures Limited* is designed to make the rendering of ligatures more context-dependent.

In the top image, you can see ligatures that don’t make sense where they are — in the regex, where three different characters are being checked (not one big two-headed arrow), and the oddly formatted asterisks in the message string.

The image below shows how those out-of-place ligatures are suppressed by *Ligatures Limited*, replaced with individual characters, while the triple-equals and double-ampersand ligatures are retained.

With the default settings for this extension ligatures are only rendered in three contexts: _operators_, _punctuation_, and _comment markers_, plus one special case: <span>`0`</span><span>`x`</span> when followed by a hexadecimal digit in a numeric context, rendered as `0×` (if supported by your chosen font).

Also by default, ligatures for `www`, `ff`, `fi`, `fl`, `ffi`, `ffl` are suppressed in all contexts, as well as the special case of `x` between any two decimal digits, which, unless suppressed, may render as (for example) `2×4`. If you want to see any of these ligatures rendered (provided, of course, that your chosen font defines them), you must expressly enable them.

Ligatures can also be suppressed (with individual characters shown instead) at the current insert cursor position (this is the default setting), for all of the current line being edited, or within all of the current text selection. This feature can be turned off entirely as well, so that the cursor position or text selection have no effect.

While the default settings should meet many users’ needs, custom settings are available to control which syntactical contexts are handled, and which particular ligatures are displayed or suppressed. Settings can be global or on a per-language basis (say, different rules for JavaScript than for Python, if you wish).

## Prerequisites

In order to take advantage of *Ligatures Limited*, you must first have ligatures enabled in Visual Studio Code, and have a ligature font like [Fira Code](https://github.com/tonsky/FiraCode) installed and selected (click [here](https://github.com/tonsky/FiraCode/wiki/VS-Code-Instructions) for instructions).

## Ligatures handled by *Ligatures Limited*

As rendered using Fira Code:
<img src="https://shetline.com/readme/ligatures-limited/v1.0.0/ligature_set.jpg" width="763" height="100" alt="Supported ligatures">

Fira Code again, but with all ligatures suppressed
<img src="https://shetline.com/readme/ligatures-limited/v1.0.0/ligature_set_suppressed.jpg" width="763" height="100" alt="Supported ligatures as individual characters">

<span>`0x`</span><span>`F`</span> represents `0x` followed by any hexadecimal digit, and <span>`9x`</span><span>`9`</span> represents `x` surrounded by any decimal digits. You can specify your own additional ligatures if you need *Ligatures Limited* to be aware of them.

## Commands

* cycleLigatureDebug
  
  This allows you to see where *Ligatures Limited* is acting upon the styling of your code. Ligatures which have been disabled will appear in red with an inverse background, and ligatures which have
  been enabled will appear in green with an inverse background. Each activation of this command cycles through the three states: debug mode fully enabled, fully disabled, and debug highlighting being up to your custom settings (which can focus debugging on particular languages and/or contexts).

* cycleSelectionMode

  Each activation of this command cycles through five different states for cursor position/text selection dependent rendering of ligatures: cursor, line, selection, off, and by-settings.

* toggleLigatureSuppression

  This allows you to disable and reënable *Ligatures Limited*’s modification of ligatures. While disabled, a faint blue tint is added to the background of your code to indicate the disabled status.

* toggleScopeHover

  This command, available as a right-click contextual menu in the text editor, turns extra hover information on and off for your code. This information shows you a *Ligatures Limited* token _category_ (described below) and TextMate scope information. This information is useful for deciding upon custom settings you might wish to apply.

## Custom settings

In lieu of a long-winded explanation of custom settings, for now I’ll just provide a link to the JSON schema, embedded in this extension’s `package.json` file, and add a few explanatory notes on top of that: <https://github.com/kshetline/ligatures-limited/blob/master/package.json>

### Contexts

A context is either a simplified token category, from the table below, or a TextMate grammar scope, such as `text.html.markdown` or `storage.type.ts`. *Ligatures Limited* works by finding possible ligature sequences in your code, using TextMate to find the types of language tokens within which these ligatures are embedded, and then applying the rules from your settings.

```text
attribute_name  comment         comment_marker  constant        function
identifier      invalid         keyword         number          operator
other           property_name   property_value  punctuation     regexp
scope           string          tag             text            type
variable
```

The rules for how *Ligatures Limited* handles ligatures can be summed up by the way you answer the question: “Which ligatures do I want to see, and which do I want suppressed, in which contexts and in which languages?”

### By-language and by-context settings

A language specifier can be a comma-separated list of languages, and a context specifier for by-context rules can be a comma-separated list of contexts.

Rules for a language can be inherited from rules for another language by using the `inherit` setting.

### Rules hierarchy

* Built-in defaults
* The global user-provided context list, disregarded ligature list, and ligature list
* Global by-context ligature lists
* When language inheritance is used, the rules of the inherited language
* Language-specific context lists and ligature lists.
* Language-specific by-context ligature lists.

### Context lists

Ligatures are _not_ rendered unless they appear inside an explicitly listed context. To add or remove contexts from the inherited rules, simply list them in a space-separated string like this:

`"regexp comment.line.double-slash.ts - comment.block.ts"`

Any contexts following the `-` sign are _removed_ from the inherited context list. The above example enables ligatures in regular expressions and line comments, but disables them in block comments.

### Ligature lists

These work much like context lists, except that an explicit `+` sign is needed to enable ligatures. Ligatures listed before either a plus or minus sign are simply added to the list of ligatures for which any action will be taken at all.

`"+ <=> ==> - ## ###"`

This example adds the first two ligatures for rendering, and causes the last two to be suppressed.

Ligature lists can also “start fresh”, clearing inherited ligatures. A leading `0` suppresses all ligatures, after which you can list just the ligatures you want to see.

A leading `X` enables all ligatures, after which you can list just the ligatures you want to suppress.

## Disregarded ligatures

The `disregardedLigatures` setting, available only at the global level, is a space-separated string of ligatures for *Ligatures Limited* to entirely ignore. If your font wants to render these ligatures, it will render them.

For example, *Ligatures Limited* suppresses these ligatures by default: `www ff fi fl ffi ffl`

The two fonts I typically use (Fira Code and my own home-brew version of Menlo) don’t have the `ff fi fl ffi ffl` ligatures anyway. By adding this setting:

`"ligaturesLimited.disregardedLigatures": "ff fi fl ffi ffl"`

...no extra effort is wasted by *Ligatures Limited* to suppress ligatures that aren’t there to suppress in the first place.

(Please note that *Ligatures Limited* can’t force ligatures to be rendered that aren’t provided by your selected font.)

## Credits

This extension is a spin-off of two other projects, [vscode-Disable-Ligatures](https://github.com/CoenraadS/vscode-Disable-Ligatures) by CoenraadS, and [scope-info](https://github.com/siegebell/scope-info), by C. J. Bell.
