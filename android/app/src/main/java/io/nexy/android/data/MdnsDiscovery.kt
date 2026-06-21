package io.nexy.android.data

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.util.concurrent.Executors

data class DiscoveredNexyService(
    val host: String,
    val port: Int,
    val token: String?,
)

class MdnsDiscovery(context: Context) {

    private val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val _discovered = MutableStateFlow<List<DiscoveredNexyService>>(emptyList())
    val discovered: StateFlow<List<DiscoveredNexyService>> = _discovered
    private var listener: NsdManager.DiscoveryListener? = null

    private val executor = Executors.newSingleThreadExecutor()

    fun startDiscovery() {
        if (listener != null) return
        val resolveQueue = mutableListOf<NsdServiceInfo>()
        var resolving = false

        fun resolveNext() {
            if (resolveQueue.isEmpty()) { resolving = false; return }
            resolving = true
            val info = resolveQueue.removeFirst()
            val resolveListener = object : NsdManager.ResolveListener {
                override fun onResolveFailed(si: NsdServiceInfo, err: Int) { resolveNext() }
                override fun onServiceResolved(si: NsdServiceInfo) {
                    val host = si.host?.hostName ?: run { resolveNext(); return }
                    val port = si.port
                    val token = si.attributes["token"]?.let { String(it) }
                    val entry = DiscoveredNexyService(host, port, token)
                    _discovered.value = (_discovered.value.filterNot { it.host == host } + entry)
                    resolveNext()
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                nsdManager.resolveService(info, executor, resolveListener)
            } else {
                @Suppress("DEPRECATION")
                nsdManager.resolveService(info, resolveListener)
            }
        }

        val dl = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(type: String) {}
            override fun onDiscoveryStopped(type: String) {}
            override fun onStartDiscoveryFailed(type: String, err: Int) {}
            override fun onStopDiscoveryFailed(type: String, err: Int) {}
            override fun onServiceFound(si: NsdServiceInfo) {
                resolveQueue.add(si)
                if (!resolving) resolveNext()
            }
            override fun onServiceLost(si: NsdServiceInfo) {
                _discovered.value = _discovered.value.filterNot { it.host == si.serviceName }
            }
        }
        listener = dl
        runCatching { nsdManager.discoverServices("_nexy._tcp.", NsdManager.PROTOCOL_DNS_SD, dl) }
    }

    fun stopDiscovery() {
        listener?.let { runCatching { nsdManager.stopServiceDiscovery(it) } }
        listener = null
        executor.shutdown()
        _discovered.value = emptyList()
    }
}
