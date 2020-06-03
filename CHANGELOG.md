## 1.2.0

* Fix problem of unresponsive behavior with large files.
* There is now configurable maximum document size (default 35M characters) and maximum line count (default 20K lines) for handling ligatures, above which _Ligatures Limited_ will leave a document as is for speedier editing and highlighting. These values can be set to 0 to ignore size or line count.

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

* Fix documentation typo.

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
