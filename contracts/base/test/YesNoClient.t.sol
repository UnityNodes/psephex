// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AiOracle} from "../src/AiOracle.sol";
import {IAiOracle} from "../src/IAiOracle.sol";
import {YesNoClient} from "../src/examples/YesNoClient.sol";

contract YesNoClientTest is Test {
    event Answered(uint256 indexed id, uint8 answer);

    AiOracle internal aio;
    YesNoClient internal client;

    address internal oracleSigner = makeAddr("oracleSigner");
    address internal user = makeAddr("user");

    string internal constant QUESTION = "Was the logo delivered as a 1024x1024 PNG?";
    uint256 internal constant FEE = 0.0001 ether;

    function setUp() public {
        aio = new AiOracle(oracleSigner, makeAddr("owner"), FEE);
        client = new YesNoClient(IAiOracle(address(aio)));
        vm.deal(user, 1 ether);
    }

    function test_askForwardsTheFeeAndRegistersTheClientAsRequester() public {
        vm.prank(user);
        uint256 id = client.ask{value: FEE}(QUESTION);
        IAiOracle.Request memory r = aio.getRequest(id);
        assertEq(r.requester, address(client));
        assertEq(r.questionHash, keccak256(bytes(QUESTION)));
        assertEq(address(aio).balance, FEE);
    }

    function test_receivesTheAnswerFromTheOracle() public {
        vm.prank(user);
        uint256 id = client.ask{value: FEE}(QUESTION);
        vm.expectEmit(true, false, false, true, address(client));
        emit Answered(id, 1);
        vm.prank(oracleSigner);
        aio.fulfill(id, 1, keccak256(bytes(QUESTION)));
    }

    function test_rejectsAnAnswerFromAnyoneButTheOracle() public {
        vm.expectRevert(YesNoClient.OnlyOracle.selector);
        vm.prank(user);
        client.onAnswer(1, 1);
    }

    function test_askWithoutTheFeeReverts() public {
        vm.expectRevert(abi.encodeWithSelector(AiOracle.InsufficientFee.selector, FEE, 0));
        vm.prank(user);
        client.ask(QUESTION);
    }
}
