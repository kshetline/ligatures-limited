## 1.4.1

* Updated to work for remote SSL and WSL sessions.

## 1.4.0

* A new version of the previous fix for Visual Studio Code 1.49.0, with no bold font limitation.
* Ability to suppress a ligature of four or more dashes, by themselves without a leading `<` or trailing `>`.

## 1.3.5

* Visual Studio Code 1.49.0 introduced a breaking change for this extension. This version fixes the main problem, but causes any suppressed ligature to be rendered in a non-bold font.

## 1.3.4

* Dependency updates.

## 1.3.3

* Improve detection of variable-form ligatures.
* Fix re-highlight problem when switching to an editor with selection at the bottom of the document.

## 1.3.2

* Fix `</` ligature.

## 1.3.1

* Fix selection mode bug.

## 1.3.0

* Further improved the speed and performance of the extension when working with large files, especially when interacting with other extensions such as [Overtype](https://marketplace.visualstudio.com/items?itemName=adammaras.overtype) and [Markdown All in One](https://marketplace.visualstudio.com/items?itemName=yzhang.markdown-all-in-one).
* The default for Markdown documents is now to display all ligatures throughout these documents, unless _Ligatures Limited_ is configured otherwise.
* The ligatures `ff`, `fi`, `fl`, `ffi`, and `ffl` are now rendered in all contexts by default. (You can change your configuration suppress these ligatures, which you may wish to do when using a font which, for example, renders `fi` within the width of a single character, instead of as two characters.)
* Cleaned up some console errors being thrown which were harmless to the functioning of the extension, but nevertheless annoying.

## 1.2.0

* Fixed problem with unresponsive behavior when editing large files.
* There is now a configurable maximum document size (default 35M characters) and maximum line count (default 20K lines), above which _Ligatures Limited_ will leave a document as is for speedier editing and highlighting. These values can be set to 0 to ignore size or line count.

## 1.1.0

* Support for indefinite-length arrow ligatures (as available in the Iosevka font).
* Optional simple true/false settings to completely enable, or completely suppress, all ligatures in all contexts for a given language.
* Handles language-specific fenced code blocks in Markdown as the specified language.
* For any font which may provide such, support for octal (`0o7`) and binary (`0b1`) number prefix ligatures, similar to the `0xF` hexadecimal prefix ligature previously supported.

## 1.0.2

* Improved error handling for invalid configurations.
* Amended documentation.
* Reduced code size.

## 1.0.1

* Fixed documentation typo.

## 1.0.0

* First non-preview release.
* Made TextMate scope specification more flexible.
* Handles CSS and JavaScript nested within HTML using proper corresponding rules.
* Fixed some ligatures which were not being matched.
* Fixed handling of comma-separated language lists.
* Added `attribute_value` category.
* Updated settings schema to include `"ligatures"` property within language specs.
* Fixed prefix of commands: now `ligaturesLimited.` instead of `extension.` (Note: any keybindings created using the preview version will have to be redone)

## 0.0.2

* Update bad choice of Marketplace background color. (Yes, even that requires a changed version number!)

## 0.0.1

* Initial preview release.
