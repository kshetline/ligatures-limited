# Ligatures Limited

## Code ligatures _only where you want them_, not where you don’t

I enjoy using ligature fonts for coding so that symbols like arrows (<img src="https://shetline.com/readme/ligatures-limited/v1.3.0/fat_arrow_nolig.png" width="16" height="14" align="absmiddle" style="display: inline-block; position: relative; top: -0.075em" alt="fat arrow no ligature">) look like arrows (<img src="https://shetline.com/readme/ligatures-limited/v1.3.0/fat_arrow.png" width="17" height="14" align="absmiddle" style="display: inline-block; position: relative; top: -0.075em" alt="fat arrow ligature">) and does-not-equal signs (<img src="https://shetline.com/readme/ligatures-limited/v1.3.0/not_equal_nolig.png" width="17" height="14" align="absmiddle" style="display: inline-block; position: relative; top: -0.075em" alt="not-equal no ligature">) look like the real thing from math class (<img src="https://shetline.com/readme/ligatures-limited/v1.3.0/not_equal.png" width="17" height="14" align="absmiddle" style="display: inline-block; position: relative; top: -0.075em" alt="not-equal ligature">). The problem is that, even with some of the contextual smarts built into ligature fonts like Fira Code, ligatures have a knack of popping up where you don’t want them.

<img src="https://shetline.com/readme/ligatures-limited/v1.3.0/without_suppressed_ligatures.jpg" width="407" height="67" alt="Without ligature suppression">
<br>
<img src="https://shetline.com/readme/ligatures-limited/v1.3.0/with_suppressed_ligatures.jpg" width="407" height="67" alt="With ligature suppression">

*Ligatures Limited* is designed to make the rendering of ligatures more context-dependent.

In the top image, you can see ligatures that don’t make sense where they are — in the regex, where three different characters are being checked (not one big two-headed arrow), and the oddly formatted asterisks in the message string.

The image below shows how those out-of-place ligatures are suppressed by *Ligatures Limited*, replaced with individual characters, while the triple-equals and double-ampersand ligatures are retained.

With the default settings for this extension ligatures are only rendered in three contexts: _operators_, _punctuation_, and _comment markers_, plus three special cases: <img src="https://shetline.com/readme/ligatures-limited/v1.3.0/0x_nolig.png" width="16" height="14" align="absmiddle" style="display: inline-block; position: relative; top: -0.075em" alt="0x ligature"> when followed by a hexadecimal digit in a numeric context, rendered as `0×` (if supported by your chosen font), and a similar pattern, `0o7` for octal numbers, and `0b1` for binary numbers as well.

Also by default, the special case of `x` between any two decimal digits is suppressed, which would render as (for example) `2×4`. If you want to see these ligatures rendered in any or all contexts, (provided, of course, that your chosen font defines them), you must expressly enable them.

Ligatures can also be suppressed (with individual characters shown instead) at the current insert cursor position (this is the default setting), for all of the current line being edited, or within all of the current text selection. This feature can be turned off entirely as well, so that the cursor position or text selection have no effect.

The ligatures `ff`, `fi`, `fl`, `ffi`, and `ffl` are by default rendered in all contexts. You can change your configuration suppress these ligatures, which you may wish to do when using a font which, for instance, renders `fi` within the width of a single character, instead of as two characters (see [Disregarded Ligatures](#disregarded-ligatures)).

While the default settings should meet many users’ needs, custom settings are available to control which syntactical contexts are handled, and which particular ligatures are displayed or suppressed. Settings can be global or on a per-language basis (say, different rules for JavaScript than for Python, if you wish).

## Prerequisites

In order to take advantage of *Ligatures Limited*, you must first have ligatures enabled in Visual Studio Code, and have a ligature font like [Fira Code](https://github.com/tonsky/FiraCode) installed and selected (click [here](https://github.com/tonsky/FiraCode/wiki/VS-Code-Instructions) for instructions).

## Ligatures handled by *Ligatures Limited*

As rendered using Fira Code:<br>
<img src="https://shetline.com/readme/ligatures-limited/v1.3.0/ligature_set.jpg" width="763" height="136" alt="Supported ligatures">

Fira Code again, but with all ligatures suppressed<br>
<img src="https://shetline.com/readme/ligatures-limited/v1.3.0/ligature_set_suppressed.jpg" width="763" height="136" alt="Supported ligatures as individual characters">

<img src="https://shetline.com/readme/ligatures-limited/v1.3.0/0xF_nolig.png" width="24" height="14" align="absmiddle" style="display: inline-block; position: relative; top: -0.075em" alt="0xF ligature"> represents `0x` followed by any hexadecimal digit, and <img src="https://shetline.com/readme/ligatures-limited/v1.3.0/9x9_nolig.png" width="24" height="14" align="absmiddle" style="display: inline-block; position: relative; top: -0.075em" alt="9x9 ligature"> represents `x` surrounded by any decimal digits. You can specify your own additional ligatures if you need *Ligatures Limited* to be aware of them.

The bottom row are indefinite-width ligatures. When specifying these ligatures, _three_ equals signs (`=`), dashes (`-`), or tildes (`~`) represent three *or more* of those signs, except for the first three ligatures, where _four_ equals signs represent four or more.

`####` is another indefinite-width ligature, representing four or more number signs (`#`) in a row.

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

A context is either a simplified token category, from the table below, or a TextMate grammar scope, such as `meta.paragraph` or `storage.type`. *Ligatures Limited* works by finding possible ligature sequences in your code, using TextMate to find the types of language tokens within which these ligatures are embedded, and then applying the rules from your settings.

```text
attribute_name  attribute_value comment         comment_marker  constant
function        identifier      invalid         keyword         number
operator        other           property_name   property_value  punctuation
regexp          scope           string          tag             text
type            variable
```

The rules for how *Ligatures Limited* handles ligatures can be summed up by the way you answer the question: “Which ligatures do I want to see, and which do I want suppressed, in which contexts and in which languages?”

When you specify a TextMate scope, only the last item listed in the hover information for that scope applies. For example:

<img src="https://shetline.com/readme/ligatures-limited/v1.3.0/textmate-scope.jpg" width="275" height="82" alt="TextMate scope">

In the case above you would specify `meta.paragraph.markdown` to refer to this context. This can be shortened to `meta.paragraph`, and that would then apply to `meta.paragraph` in any language.

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

### Disregarded ligatures

The `disregardedLigatures` setting, available only at the global level, is a space-separated string of ligatures for *Ligatures Limited* to entirely ignore. If your font wants to render these ligatures, it will render them regardless of context.

*Ligatures Limited* disregards the following ligatures by default: `ff fi fl ffi ffl`

Ligatures you specify for `disregardedLigatures` will be added to the above default list.

If you need to *un*disregard (for lack of a better word) any of these by-default disregarded ligatures, simply using them in any ligature list will bring them back into consideration for all ligature processing.

(Please note that *Ligatures Limited* can’t force ligatures to be rendered that aren’t provided by your selected font in the first place.)

### File size limits

To prevent Visual Studio Code from getting bogged down when handling very large files (way too large to be normal, proper source code files), there are default limits on the size of files which will be handled: no more than 20K lines, and no more than 35M characters. These limits can be modified using `"ligaturesLimited.maxLines"` and `"ligaturesLimited.maxFileSize"`. If you set these values to zero, size checking is disabled.

### Sample configuration

```json
{
  "ligaturesLimited.languages": {
    "css, javascript": {
      "ligaturesByContext": {
        "comment.block": {
          "ligatures": "0 www"
        }
      }
    },
    "html": {
      "ligaturesByContext": {
        "attribute_value": {
          "ligatures": "0 www"
        }
      }
    },
    "typescript": {
      "inherit": "javascript",
      "ligatures": "- !="
    },
    "markdown": true,
    "plaintext, json, jsonc, json5": false
  }
}
```

This configuration enables `www` ligatures, and only `www` ligatures, within block comments for CSS and JavaScript.

TypeScript inherits the above behavior, and also disables the `!=` ligature in all contexts.

For HTML, the `www` ligature is rendered only inside attribute values.

Markdown has all ligatures enabled, and plain text and various forms of JSON have all ligatures disabled.

## Known Issues

* Occasionally, when working with large files, a console warning `UNRESPONSIVE extension host` may appear, but despite the wording of the message VSCode remains responsive anyway.

## Credits

This extension is partially a spin-off of two other projects, [vscode-Disable-Ligatures](https://github.com/CoenraadS/vscode-Disable-Ligatures) by CoenraadS, and [scope-info](https://github.com/siegebell/scope-info), by C. J. Bell.
