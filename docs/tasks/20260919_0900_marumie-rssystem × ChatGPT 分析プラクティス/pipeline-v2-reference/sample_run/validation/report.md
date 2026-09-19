# Pipeline V2 reference validation report

## Source inventory

- files: 311
- bytes: 109,783,436
- MOF files: 35
- RS files: 276
- FY2024 settlement explanation PDF present: True

## MOF FY2024

Normalized rows: 19,680

### Section counts

| phase | status | rev | account | source-preserving | legacy code-centric |
|---|---|---:|---|---:|---:|
| initial | enacted |  | agency | 22 | 22 |
| initial | enacted |  | general | 784 | 784 |
| initial | enacted |  | special | 250 | 248 |
| settlement | settled |  | agency | 22 | 22 |
| settlement | settled |  | general | 978 | 978 |
| settlement | settled |  | special | 272 | 270 |
| supplement | published | 1 | general | 799 | 799 |
| supplement | published | 1 | special | 200 | 198 |

### Settlement equations

- checked rows: 8,358
- budget-components → current-budget mismatches: 0
- current-budget → spent+carryover+unused mismatches: 0

### Code collisions preserved by V2

- initial / special / `special|国会、裁判所、会計検査院、内閣、内閣府、デジタル庁、復興庁、総務省、法務省、外務省、財務省、文部科学省、厚生労働省、農林水産省、経済産業省、国土交通省、環境省及び防衛省|東日本大震災復興||01` → 復興債費, 復興庁共通費
- initial / special / `special|国会、裁判所、会計検査院、内閣、内閣府、デジタル庁、復興庁、総務省、法務省、外務省、財務省、文部科学省、厚生労働省、農林水産省、経済産業省、国土交通省、環境省及び防衛省|東日本大震災復興||02` → 復興加速化・福島再生予備費, 東日本大震災復興支援対策費
- settlement / special / `special|国会、裁判所、会計検査院、内閣、内閣府、デジタル庁、復興庁、総務省、法務省、外務省、財務省、文部科学省、厚生労働省、農林水産省、経済産業省、国土交通省、環境省及び防衛省|東日本大震災復興||01` → 復興債費, 復興庁共通費
- settlement / special / `special|国会、裁判所、会計検査院、内閣、内閣府、デジタル庁、復興庁、総務省、法務省、外務省、財務省、文部科学省、厚生労働省、農林水産省、経済産業省、国土交通省、環境省及び防衛省|東日本大震災復興||02` → 復興加速化・福島再生予備費, 東日本大震災復興支援対策費
- supplement / special / `special|国会、裁判所、会計検査院、内閣、内閣府、デジタル庁、復興庁、総務省、法務省、外務省、財務省、文部科学省、厚生労働省、農林水産省、経済産業省、国土交通省、環境省及び防衛省|東日本大震災復興||01` → 復興債費, 復興庁共通費
- supplement / special / `special|国会、裁判所、会計検査院、内閣、内閣府、デジタル庁、復興庁、総務省、法務省、外務省、財務省、文部科学省、厚生労働省、農林水産省、経済産業省、国土交通省、環境省及び防衛省|東日本大震災復興||02` → 復興加速化・福島再生予備費, 東日本大震災復興支援対策費

### Submitted → enacted amendments

- changed item groups: 0
- net delta: 0 yen
- by account: {}

## MOF FY2025

Normalized rows: 19,623

### Section counts

| phase | status | rev | account | source-preserving | legacy code-centric |
|---|---|---:|---|---:|---:|
| initial | enacted |  | agency | 22 | 22 |
| initial | enacted |  | general | 806 | 806 |
| initial | enacted |  | special | 254 | 252 |
| initial | submitted |  | general | 806 | 806 |
| initial | submitted |  | special | 254 | 252 |
| supplement | published | 1 | general | 800 | 800 |
| supplement | published | 1 | special | 198 | 196 |

### Settlement equations

- checked rows: 0
- budget-components → current-budget mismatches: 0
- current-budget → spent+carryover+unused mismatches: 0

### Code collisions preserved by V2

- initial / special / `special|国会、裁判所、会計検査院、内閣、内閣府、デジタル庁、復興庁、総務省、法務省、外務省、財務省、文部科学省、厚生労働省、農林水産省、経済産業省、国土交通省、環境省及び防衛省|東日本大震災復興||01` → 復興債費, 復興庁共通費
- initial / special / `special|国会、裁判所、会計検査院、内閣、内閣府、デジタル庁、復興庁、総務省、法務省、外務省、財務省、文部科学省、厚生労働省、農林水産省、経済産業省、国土交通省、環境省及び防衛省|東日本大震災復興||01` → 復興債費, 復興庁共通費
- initial / special / `special|国会、裁判所、会計検査院、内閣、内閣府、デジタル庁、復興庁、総務省、法務省、外務省、財務省、文部科学省、厚生労働省、農林水産省、経済産業省、国土交通省、環境省及び防衛省|東日本大震災復興||02` → 復興加速化・福島再生予備費, 東日本大震災復興支援対策費
- initial / special / `special|国会、裁判所、会計検査院、内閣、内閣府、デジタル庁、復興庁、総務省、法務省、外務省、財務省、文部科学省、厚生労働省、農林水産省、経済産業省、国土交通省、環境省及び防衛省|東日本大震災復興||02` → 復興加速化・福島再生予備費, 東日本大震災復興支援対策費
- supplement / special / `special|国会、裁判所、会計検査院、内閣、内閣府、デジタル庁、復興庁、総務省、法務省、外務省、財務省、文部科学省、厚生労働省、農林水産省、経済産業省、国土交通省、環境省及び防衛省|東日本大震災復興||01` → 復興債費, 復興庁共通費
- supplement / special / `special|国会、裁判所、会計検査院、内閣、内閣府、デジタル庁、復興庁、総務省、法務省、外務省、財務省、文部科学省、厚生労働省、農林水産省、経済産業省、国土交通省、環境省及び防衛省|東日本大震災復興||02` → 復興加速化・福島再生予備費, 東日本大震災復興支援対策費

### Submitted → enacted amendments

- changed item groups: 17
- net delta: -356,655,880,000 yen
- by account: {'general': 14, 'special': 3}

## RS review 2024

- budget-item rows: 55,609
- fiscal years: {'2021': 11369, '2022': 11940, '2023': 15954, '2024': 16346}
- request fiscal years: {'2022': 9110, '2023': 9502, '2024': 11837, '2025': 11423}
- reviewYear != fiscalYear exists: True
- next-year request beyond reviewYear exists: True

## RS review 2025

- budget-item rows: 70,915
- fiscal years: {'2021': 10841, '2022': 11286, '2023': 15099, '2024': 16646, '2025': 17043}
- request fiscal years: {'2022': 8695, '2023': 9010, '2024': 11341, '2025': 11309, '2026': 11442}
- reviewYear != fiscalYear exists: True
- next-year request beyond reviewYear exists: True

## MOF ↔ RS exact-name linkage reference

- 2024:2024: groups=4932, linked RS rows=13345, linked projects=4673, unlinked RS rows=1190
- 2025:2024: groups=4914, linked RS rows=13087, linked projects=4537, unlinked RS rows=1093
- 2025:2025: groups=5086, linked RS rows=14017, linked projects=4851, unlinked RS rows=1034

