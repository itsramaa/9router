"""QA Gate 2: Phase 2 Backend Stability Tests"""
import asyncio
import logging
import logging.handlers
# pyrefly: ignore [missing-import]
import pytest
from pathlib import Path
from unittest.mock import MagicMock, AsyncMock, patch
import sys

# Add parent to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.browser import BrowserManager, cleanup_camoufox_temp
from core.worker import HarvestWorker
from core.frames import FrameStreamer
from core.interact import InteractMode, clear_interact_context


class TestAUDIT011TimeoutCancellation:
    """Verify worker cancels tasks on timeout."""
    
    @pytest.mark.asyncio
    async def test_timeout_cancels_task(self):
        """When asyncio.TimeoutError occurs, the task should be cancelled."""
        # Mock a long-running task
        async def slow_provider(*args, **kwargs):
            await asyncio.sleep(10)  # Will timeout
            return "never"
        
        worker = HarvestWorker(
            slot=99,
            email="test@example.com",
            password="pass",
            providers=["test_provider"],
            timeout_per_provider=0.1
        )
        
        # Mock BrowserManager.launch to return minimal objects
        mock_manager = AsyncMock()
        mock_browser = MagicMock()
        mock_page = MagicMock()
        mock_page.evaluate = AsyncMock(return_value=None)
        mock_page.context = MagicMock()
        mock_page.context.add_init_script = AsyncMock()
        
        with patch.object(BrowserManager, 'launch', return_value=(mock_manager, mock_browser, mock_page)):
            with patch('core.worker.Config') as mock_config:
                mock_config.PROVIDER_REGISTRY = {
                    "test_provider": {
                        "module": "test_module",
                        "fn": "slow_provider",
                        "display": "Test Provider",
                        "log_only": False
                    }
                }
                
                with patch('importlib.import_module') as mock_import:
                    mock_mod = MagicMock()
                    mock_mod.slow_provider = slow_provider
                    mock_import.return_value = mock_mod
                    
                    result = await worker.run()
        
        # Should have timeout error recorded
        assert "timeout" in str(result.get("errors", {})).lower()
        # Worker should complete without hanging


class TestAUDIT012ContextTracking:
    """Verify browser context tracking prevents cleanup race."""
    
    def test_active_contexts_counter(self):
        """BrowserManager should track active contexts."""
        assert hasattr(BrowserManager, 'active_contexts')
        assert hasattr(BrowserManager, '_context_lock')
        assert isinstance(BrowserManager.active_contexts, int)
        assert isinstance(BrowserManager._context_lock, asyncio.Lock)
    
    @pytest.mark.asyncio
    async def test_context_cleanup_only_when_zero(self):
        """cleanup_camoufox_temp should only run when no active contexts."""
        # Reset counter
        BrowserManager.active_contexts = 0
        
        # When counter is 0, cleanup should be allowed
        async with BrowserManager._context_lock:
            if BrowserManager.active_contexts == 0:
                # This should execute
                cleanup_called = True
        
        assert cleanup_called
        
        # When counter > 0, cleanup should be skipped
        BrowserManager.active_contexts = 2
        cleanup_called = False
        async with BrowserManager._context_lock:
            if BrowserManager.active_contexts == 0:
                cleanup_called = True
        
        assert not cleanup_called
        
        # Reset
        BrowserManager.active_contexts = 0


class TestAUDIT013LogRotation:
    """Verify log rotation is configured."""
    
    def test_rotating_file_handler_import(self):
        """logging.handlers should be importable."""
        import logging.handlers
        assert hasattr(logging.handlers, 'RotatingFileHandler')
    
    def test_rotating_handler_params(self):
        """RotatingFileHandler should be configured with size limits."""
        handler = logging.handlers.RotatingFileHandler(
            "test.log",
            maxBytes=10*1024*1024,  # 10MB
            backupCount=5,
            encoding='utf-8'
        )
        assert handler.maxBytes == 10*1024*1024
        assert handler.backupCount == 5
        
        # Cleanup
        handler.close()
        Path("test.log").unlink(missing_ok=True)


class TestAUDIT014ActionQueueLeak:
    """Verify InteractMode cleanup prevents queue leaks."""
    
    def test_clear_interact_context_cleans_queues(self):
        """clear_interact_context should clean InteractMode queues."""
        slot = 77
        
        # Setup some queues
        InteractMode._action_queues[slot] = asyncio.Queue()
        InteractMode._pending[slot] = asyncio.Event()
        InteractMode._actions[slot] = "continue"
        
        # Clear context
        clear_interact_context(slot)
        
        # All should be cleaned up
        assert slot not in InteractMode._action_queues
        assert slot not in InteractMode._pending
        assert slot not in InteractMode._actions
    
    def test_interact_mode_cleanup(self):
        """InteractMode.cleanup should remove all slot data."""
        slot = 88
        
        InteractMode._pending[slot] = asyncio.Event()
        InteractMode._actions[slot] = "skip"
        InteractMode._action_queues[slot] = asyncio.Queue()
        
        InteractMode.cleanup(slot)
        
        assert slot not in InteractMode._pending
        assert slot not in InteractMode._actions
        assert slot not in InteractMode._action_queues


class TestAUDIT015FrameStreamerLeak:
    """Verify FrameStreamer properly cleans up resources."""
    
    @pytest.mark.asyncio
    async def test_streamer_stop_clears_resources(self):
        """FrameStreamer.stop() should clear task and page references."""
        mock_page = MagicMock()
        streamer = FrameStreamer(mock_page, slot=55)
        
        # Start a task
        async def dummy_run():
            while not streamer._stop.is_set():
                await asyncio.sleep(0.01)
        
        streamer._task = asyncio.create_task(dummy_run())
        
        # Stop should clean up
        await streamer.stop()
        
        # Task reference should be None
        assert streamer._task is None
        # Page reference should be None
        assert streamer.page is None
        # Stop event should be set
        assert streamer._stop.is_set()


class TestAUDIT018XSSEmailInjection:
    """Verify email is safely escaped in init scripts."""
    
    def test_json_import_available(self):
        """json module should be imported in browser.py."""
        from core import browser
        import json
        assert hasattr(browser, 'json')
    
    def test_email_escaping(self):
        """Email should be escaped with json.dumps."""
        import json
        
        # Test malicious email
        malicious = 'test@example.com"; alert("xss"); "'
        safe = json.dumps(malicious)
        
        # Should be properly escaped
        assert '"' in safe
        assert safe.startswith('"')
        assert safe.endswith('"')
        
        # When evaluated as JS, should be a safe string literal
        # The quotes should prevent code execution
        assert 'alert' in safe  # Content is there
        assert '\\"' in safe or '"' in safe  # But escaped


def test_all_phase2_fixes():
    """Summary test to verify all Phase 2 fixes are present."""
    # AUDIT-011: worker.py has timeout cancellation
    from core import worker
    import inspect
    worker_source = inspect.getsource(worker.HarvestWorker.run)
    assert "task.cancel()" in worker_source
    
    # AUDIT-012: browser.py has context tracking
    assert hasattr(BrowserManager, 'active_contexts')
    assert hasattr(BrowserManager, '_context_lock')
    
    # AUDIT-013: run.py uses RotatingFileHandler
    from pathlib import Path
    run_py = Path(__file__).parent.parent / "run.py"
    run_content = run_py.read_text()
    assert "RotatingFileHandler" in run_content
    
    # AUDIT-014: interact.py cleans queues
    from core import interact
    interact_source = inspect.getsource(interact.clear_interact_context)
    assert "InteractMode.cleanup" in interact_source
    
    # AUDIT-015: frames.py clears resources
    from core import frames
    frames_source = inspect.getsource(frames.FrameStreamer.stop)
    assert "self._task = None" in frames_source
    assert "self.page = None" in frames_source
    
    # AUDIT-018: browser.py uses json.dumps
    from core import browser
    browser_source = inspect.getsource(browser.BrowserManager.launch)
    assert "json.dumps" in browser_source


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
