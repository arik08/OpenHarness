from myharness.channels.impl.slack import _thread_session_key


def test_slack_thread_session_key_keeps_sender_scope():
    assert _thread_session_key("C123", "1710000000.000100", "U123", "channel") == (
        "slack:C123:1710000000.000100:U123"
    )


def test_slack_thread_session_key_does_not_override_dm_sessions():
    assert _thread_session_key("D123", "1710000000.000100", "U123", "im") is None
