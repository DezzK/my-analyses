-- Full-text index over analyte names, aliases and lab codes, maintained by AnalyteService.reindex.
-- The trigram tokenizer folds case (Cyrillic included) and matches any substring of 3+ characters;
-- the indexed text is pre-normalized by normalizeSearchText (ё → е), which FTS5 does not fold.
CREATE VIRTUAL TABLE `analyte_search` USING fts5(`analyte_id` UNINDEXED, `text`, tokenize = 'trigram');
