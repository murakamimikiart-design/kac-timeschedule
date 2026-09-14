# タイムスケジュール自動作成ツール - プロジェクト構成

## 📁 フォルダ構成

```
TS/
├── timeschedule_generator.py    # メインスクリプト（Excel生成）
├── sample_data.json              # JSONサンプルデータ
├── requirements.txt              # Python依存ライブラリ
├── README.md                      # 使い方ガイド
├── PROJECT_STRUCTURE.md           # このファイル
└── outputs/                       # 生成されたExcelファイル出力先（自動作成）
```

## 🚀 Code環境での開発フロー

### 1. 初期セットアップ

```bash
cd TS

# 依存ライブラリをインストール
pip install -r requirements.txt
```

### 2. サンプルで動作確認

```bash
python3 timeschedule_generator.py sample_data.json outputs/sample.xlsx
```

### 3. カスタムデータで実行

```bash
python3 timeschedule_generator.py your_data.json outputs/your_schedule.xlsx
```

## 📝 開発中の改良項目

### Phase 1: 基本機能の強化
- [ ] 複数イベント重なり検出機能
- [ ] 重なり表記の可視化（時間帯ごとの重複カウント）
- [ ] スタッフ別タイムラインシート生成

### Phase 2: 機能拡張
- [ ] スタッフマスターのJSONエクスポート機能
- [ ] 制約条件タグ対応（「音出し不可」など）
- [ ] テンプレート機能

### Phase 3: UI/UX向上
- [ ] ブラウザ版にJSON出力ボタン追加
- [ ] エラーハンドリング強化
- [ ] ログ出力機能

## 🔧 コード編集時のポイント

### timeschedule_generator.py の主要クラス

```python
class TimescheduleGenerator:
    __init__(self, data)        # データ初期化
    create_workbook()           # Excel生成のメイン
    _create_staff_sheet()       # スタッフマスターシート作成
    _create_timeline_sheet()    # タイムラインシート作成
    _create_event_detail_sheet() # イベント詳細シート作成
```

### 色定義

```python
self.colors = {
    'setup': 'FFEB99',          # 黄（仕込み/搬入/準備）
    'performance': 'C6EFCE',    # 緑（本番/開催/トーク）
    'teardown': 'FFC7CE',       # 赤（撤収/搬出/片付け）
}
```

### JSONデータ構造

```json
{
  "staff_data": {
    "technical": ["名前"],
    "personnel": ["名前"]
  },
  "events": [{
    "date": "YYYY-MM-DD",
    "name": "イベント名",
    "type": "stage|exhibition|workshop|talk",
    "location": "場所",
    "phases": [{
      "type": "setup|performance|teardown",
      "label": "ラベル",
      "startTime": "HH:MM",
      "endTime": "HH:MM",
      "technical": ["名前"],
      "personnel": ["名前"]
    }]
  }]
}
```

## 🧪 テスト方法

### 単一イベントでテスト
- 1イベント、1フェーズで動作確認

### 複数イベント・重なりでテスト
- 複数日付、時間重複シナリオで確認
- 同時進行時の表示が正しいか確認

### エッジケース
- 23:00直前のフェーズ
- スタッフ未割り当てのフェーズ
- 空のstaff_data

## 📊 出力Excel の仕様

### Sheet 1: タイムスケジュール
- 行：イベント（日付/名前/場所）
- 列：9:00-23:00（15時間）
- セル内容：フェーズラベル + スタッフ情報
- 色分け：フェーズタイプで自動着色

### Sheet 2: スタッフマスター
- テクニカル欄、担当者欄

### Sheet 3: イベント詳細
- 全フェーズの情報を表形式で一覧

## 🔗 関連リソース

- ブラウザ版（HTML/JS）：チャット履歴に保存
- サンプルExcel：`outputs/sample.xlsx`
- 使い方ガイド：`README.md`
