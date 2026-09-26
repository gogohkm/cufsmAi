"""pytest 수집용 경로 설정 (test/python/*_entry 수집 시 python/ 패키지 노출)."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'test', 'python'))
sys.path.insert(0, os.path.join(ROOT, 'python'))
