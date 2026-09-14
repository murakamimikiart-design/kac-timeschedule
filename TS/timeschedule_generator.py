#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
タイムスケジュール自動作成ツール - Excel生成版
JSONフォーマットのイベントデータからExcelタイムスケジュールを生成
"""

import json
import sys
from datetime import datetime
from openpyxl import Workbook
from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
from openpyxl.utils import get_column_letter

class TimescheduleGenerator:
    def __init__(self, data):
        self.data = data
        self.events = data.get('events', [])
        self.staff_data = data.get('staff_data', {'technical': [], 'personnel': []})
        
        # 色設定
        self.colors = {
            'setup': 'FFEB99',      # 黄（仕込み/搬入/準備）
            'performance': 'C6EFCE', # 緑（本番/開催/トーク）
            'teardown': 'FFC7CE',    # 赤（撤収/搬出/片付け）
            'header': 'CCCCCC',      # 薄灰色
        }
        
        self.phase_labels = {
            'stage': {'setup': '仕込み', 'performance': '本番', 'teardown': '撤収'},
            'exhibition': {'setup': '搬入', 'performance': '開催', 'teardown': '搬出'},
            'workshop': {'setup': '準備', 'performance': '開催', 'teardown': '片付け'},
            'talk': {'setup': '準備', 'performance': 'トーク', 'teardown': '片付け'},
        }
    
    def create_workbook(self, output_path):
        """Excelワークブックを作成"""
        wb = Workbook()
        ws = wb.active
        ws.title = "タイムスケジュール"
        
        # スタッフマスターシートを追加
        staff_ws = wb.create_sheet("スタッフマスター")
        self._create_staff_sheet(staff_ws)
        
        # タイムラインシートを作成
        self._create_timeline_sheet(ws)
        
        # イベント詳細シートを作成
        if self.events:
            detail_ws = wb.create_sheet("イベント詳細")
            self._create_event_detail_sheet(detail_ws)
        
        wb.save(output_path)
        print(f"✓ Excelファイルを生成しました: {output_path}")
    
    def _create_staff_sheet(self, ws):
        """スタッフマスターシートを作成"""
        ws['A1'] = 'テクニカル'
        ws['A1'].font = Font(bold=True, size=12)
        ws['A1'].fill = PatternFill(start_color=self.colors['header'], fill_type='solid')
        
        for i, name in enumerate(self.staff_data.get('technical', []), start=2):
            ws[f'A{i}'] = name
        
        ws['B1'] = '担当者'
        ws['B1'].font = Font(bold=True, size=12)
        ws['B1'].fill = PatternFill(start_color=self.colors['header'], fill_type='solid')
        
        for i, name in enumerate(self.staff_data.get('personnel', []), start=2):
            ws[f'B{i}'] = name
        
        ws.column_dimensions['A'].width = 20
        ws.column_dimensions['B'].width = 20
    
    def _create_timeline_sheet(self, ws):
        """タイムラインシートを作成"""
        # ヘッダー行
        ws['A1'] = '日付/場所/イベント'
        ws['A1'].font = Font(bold=True)
        ws['A1'].fill = PatternFill(start_color=self.colors['header'], fill_type='solid')
        
        # 時間ヘッダー（9:00 - 23:00）
        for hour in range(9, 24):
            col = hour - 8  # A=1なので、hour 9 -> col 2
            col_letter = get_column_letter(col + 1)
            ws[f'{col_letter}1'] = f'{hour:02d}:00'
            ws[f'{col_letter}1'].font = Font(bold=True, size=9)
            ws[f'{col_letter}1'].fill = PatternFill(start_color=self.colors['header'], fill_type='solid')
            ws[f'{col_letter}1'].alignment = Alignment(horizontal='center', vertical='center')
        
        ws.column_dimensions['A'].width = 30
        for col in range(2, 16):
            ws.column_dimensions[get_column_letter(col)].width = 12
        
        # 日付でグループ化
        dates = sorted(set(event['date'] for event in self.events))
        row = 2
        
        thin_border = Border(
            left=Side(style='thin'),
            right=Side(style='thin'),
            top=Side(style='thin'),
            bottom=Side(style='thin')
        )
        
        for date in dates:
            date_events = [e for e in self.events if e['date'] == date]
            
            for event in date_events:
                # イベント行
                ws[f'A{row}'] = f"{date}\n{event['name']}\n({event['location']})"
                ws[f'A{row}'].alignment = Alignment(wrap_text=True, vertical='top')
                ws.row_dimensions[row].height = 45
                
                # 時間軸に沿ってフェーズを埋める
                for hour in range(9, 24):
                    col_letter = get_column_letter(hour - 8 + 1)
                    
                    # このhourに該当するフェーズを探す
                    active_phase = None
                    for phase in event['phases']:
                        start_hour = int(phase['startTime'].split(':')[0])
                        end_hour = int(phase['endTime'].split(':')[0])
                        if start_hour <= hour < end_hour:
                            active_phase = phase
                            break
                    
                    if active_phase:
                        event_type = event.get('type', 'stage')
                        label = active_phase.get('label', self.phase_labels[event_type][active_phase['type']])
                        
                        # スタッフ情報
                        technical = ', '.join(active_phase.get('technical', []))
                        personnel = ', '.join(active_phase.get('personnel', []))
                        staff_info = '\n'.join(filter(None, [technical, personnel]))
                        
                        cell_value = label
                        if staff_info:
                            cell_value += f'\n{staff_info}'
                        
                        cell = ws[f'{col_letter}{row}']
                        cell.value = cell_value
                        cell.alignment = Alignment(wrap_text=True, vertical='top', horizontal='center')
                        cell.fill = PatternFill(start_color=self.colors[active_phase['type']], fill_type='solid')
                        cell.border = thin_border
                        cell.font = Font(size=8)
                    else:
                        cell = ws[f'{col_letter}{row}']
                        cell.border = thin_border
                
                ws[f'A{row}'].border = thin_border
                row += 1
            
            # 日付ごとに空行を追加
            row += 1
    
    def _create_event_detail_sheet(self, ws):
        """イベント詳細シートを作成"""
        # ヘッダー
        headers = ['日付', 'イベント名', 'タイプ', '場所', 'フェーズ', 'ラベル', '開始時刻', '終了時刻', 'テクニカル', '担当者']
        for col, header in enumerate(headers, start=1):
            cell = ws.cell(row=1, column=col)
            cell.value = header
            cell.font = Font(bold=True)
            cell.fill = PatternFill(start_color=self.colors['header'], fill_type='solid')
        
        # データ行
        row = 2
        for event in self.events:
            event_type = event.get('type', 'stage')
            for phase in event['phases']:
                ws.cell(row=row, column=1).value = event['date']
                ws.cell(row=row, column=2).value = event['name']
                ws.cell(row=row, column=3).value = {'stage': '舞台', 'exhibition': '展覧会', 'workshop': 'WS', 'talk': 'トーク'}.get(event_type, '---')
                ws.cell(row=row, column=4).value = event['location']
                ws.cell(row=row, column=5).value = self.phase_labels[event_type][phase['type']]
                ws.cell(row=row, column=6).value = phase.get('label', '')
                ws.cell(row=row, column=7).value = phase['startTime']
                ws.cell(row=row, column=8).value = phase['endTime']
                ws.cell(row=row, column=9).value = ', '.join(phase.get('technical', []))
                ws.cell(row=row, column=10).value = ', '.join(phase.get('personnel', []))
                
                # 色を付ける
                color = self.colors[phase['type']]
                for col in range(1, 11):
                    ws.cell(row=row, column=col).fill = PatternFill(start_color=color, fill_type='solid')
                
                row += 1
        
        # 列幅を自動調整
        for col in range(1, 11):
            ws.column_dimensions[get_column_letter(col)].width = 15


def load_sample_data():
    """サンプルデータを返す"""
    return {
        "staff_data": {
            "technical": ["鬣さん", "川瀬彪", "十河さん"],
            "personnel": ["村上美樹", "原田さん", "青田", "雪岡"]
        },
        "events": [
            {
                "date": "2026-09-12",
                "name": "明倫レコード倶楽部",
                "type": "stage",
                "location": "フリースペース",
                "phases": [
                    {
                        "type": "setup",
                        "label": "午前中設営",
                        "startTime": "09:00",
                        "endTime": "14:30",
                        "technical": [],
                        "personnel": ["原田さん"]
                    },
                    {
                        "type": "performance",
                        "label": "本番",
                        "startTime": "15:00",
                        "endTime": "18:00",
                        "technical": [],
                        "personnel": ["原田さん"]
                    }
                ]
            },
            {
                "date": "2026-09-12",
                "name": "UAC",
                "type": "exhibition",
                "location": "講堂",
                "phases": [
                    {
                        "type": "setup",
                        "label": "設営・本番",
                        "startTime": "12:00",
                        "endTime": "20:00",
                        "technical": ["鬣さん", "川瀬彪"],
                        "personnel": ["村上美樹"]
                    }
                ]
            },
            {
                "date": "2026-09-12",
                "name": "TARO",
                "type": "exhibition",
                "location": "北ギャラリー",
                "phases": [
                    {
                        "type": "performance",
                        "label": "展示・撤収",
                        "startTime": "10:00",
                        "endTime": "17:00",
                        "technical": ["鬣さん"],
                        "personnel": []
                    }
                ]
            }
        ]
    }


if __name__ == '__main__':
    # JSONファイルまたはサンプルデータから読み込み
    if len(sys.argv) > 1 and sys.argv[1].endswith('.json'):
        with open(sys.argv[1], 'r', encoding='utf-8') as f:
            data = json.load(f)
        output_file = sys.argv[2] if len(sys.argv) > 2 else 'timeschedule.xlsx'
    else:
        # サンプルデータを使用
        data = load_sample_data()
        output_file = 'timeschedule_sample.xlsx'
    
    # Excelを生成
    generator = TimescheduleGenerator(data)
    generator.create_workbook(output_file)
    print(f"\n生成されたファイル: {output_file}")
