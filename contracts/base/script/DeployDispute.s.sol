// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Dispute} from "../src/Dispute.sol";

contract DeployDispute is Script {
    function run() external returns (Dispute deployed) {
        address aiOracle = vm.envAddress("AI_ORACLE_ADDRESS");
        uint64 timeout = uint64(vm.envOr("DISPUTE_TIMEOUT", uint256(1 days)));
        uint256 minStake = vm.envUint("MIN_STAKE_WEI");
        vm.startBroadcast();
        deployed = new Dispute(aiOracle, timeout, minStake);
        vm.stopBroadcast();
        console.log("Dispute", address(deployed));
        console.log("aiOracle", aiOracle);
        console.log("minStake", minStake);
    }
}
